import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { config } from '../config'
import type { AgentEvent } from './types'

/** コールバックで届くイベントを async iterator に橋渡しするだけの入れ物。 */
class EventQueue<T> {
  private items: T[] = []
  private waiting: Array<(result: IteratorResult<T>) => void> = []
  private pendingError: Error | null = null
  private done = false

  push(item: T): void {
    const waiter = this.waiting.shift()
    if (waiter) waiter({ value: item, done: false })
    else this.items.push(item)
  }

  finish(error?: Error): void {
    if (this.done) return
    this.done = true
    this.pendingError = error ?? null
    while (this.waiting.length > 0) {
      this.waiting.shift()!({ value: undefined as never, done: true })
    }
  }

  async *drain(): AsyncGenerator<T> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift()!
        continue
      }
      if (this.done) {
        if (this.pendingError) throw this.pendingError
        return
      }
      const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve))
      if (result.done) {
        if (this.pendingError) throw this.pendingError
        return
      }
      yield result.value
    }
  }
}

/**
 * どちらの CLI もログイン情報を HOME 以下や OS のキーチェーンから読むため、
 * 環境変数は原則そのまま渡す。ただし、開発中に Claude Code の中から
 * 起動したときに紛れ込む入れ子用の変数だけは落としておく。
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LANG: process.env.LANG ?? 'C.UTF-8' }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key === 'CLAUDE_PID') {
      delete env[key]
    }
  }
  // 効き方が読めなくなるので、効力の指定は引数側に一本化する。
  delete env.CLAUDE_EFFORT
  return env
}

export interface ProcessSpec {
  bin: string
  args: string[]
  cwd: string
  /** プロンプトは履歴を含んで長くなるので、引数ではなく標準入力から渡す。 */
  stdin: string
  signal?: AbortSignal
  /** JSON 1 行ごとに呼ばれる。本文の差分はここで emit する。 */
  onLine(line: Record<string, unknown>, emit: (event: AgentEvent) => void): void
  /** 正常終了したときに採用する最終本文。 */
  finalText(): string
  /** 終了を示す行を見たか。見ていなければ異常終了として扱う。 */
  finished(): boolean
  /** CLI 側がエラーを報告していれば、その文言。 */
  reportedError(): string | null
}

/** JSON Lines を吐く CLI を起動して、本文の差分と最終結果を流す。 */
export async function* runProcess(spec: ProcessSpec): AsyncGenerator<AgentEvent> {
  const queue = new EventQueue<AgentEvent>()

  const child = spawn(spec.bin, spec.args, {
    cwd: spec.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv(),
  })

  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
  }, config.requestTimeoutMs)

  const onAbort = () => child.kill('SIGTERM')
  spec.signal?.addEventListener('abort', onAbort, { once: true })

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    // 上限を設けないと、暴走時にメモリを持っていかれる。
    if (stderr.length < 8_000) stderr += chunk
  })

  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      return // 想定外の行は捨てる
    }
    spec.onLine(parsed, (event) => queue.push(event))
  })

  child.on('error', (error) => {
    queue.finish(new Error(`${spec.bin} を起動できませんでした: ${error.message}`))
  })

  child.on('close', (code, signal) => {
    clearTimeout(timer)
    spec.signal?.removeEventListener('abort', onAbort)

    if (signal) {
      queue.finish(
        new Error(signal === 'SIGTERM' ? '応答が時間内に終わりませんでした' : `中断されました (${signal})`),
      )
      return
    }

    const reported = spec.reportedError()
    if (reported) {
      queue.finish(new Error(reported))
      return
    }
    if (code !== 0 || !spec.finished()) {
      queue.finish(new Error(stderr.trim() || `${spec.bin} が異常終了しました (code ${code})`))
      return
    }

    queue.push({ type: 'done', text: spec.finalText() })
    queue.finish()
  })

  child.stdin.end(spec.stdin, 'utf8')

  yield* queue.drain()
}
