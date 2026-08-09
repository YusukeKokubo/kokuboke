import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { config } from '../config'

export type RunnerEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; sessionId: string | null; costUsd: number | null }

export interface RunOptions {
  /** 作業ディレクトリ。ここの CLAUDE.md が親を遡って読み込まれる。 */
  cwd: string
  prompt: string
  appendSystemPrompt?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  /** cwd の外にも触らせたいときに渡す。 */
  addDirs?: string[]
  permissionMode?: 'dontAsk' | 'acceptEdits'
  model?: string
  signal?: AbortSignal
}

/** 明示的に禁止しておくツール。許可リストだけに頼らず二重に塞ぐ。 */
const ALWAYS_DENIED = [
  'Bash',
  'Task',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'KillShell',
  'BashOutput',
]

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
    // 待っている取り出しを全部起こす。エラーは次の next() で投げる。
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
 * Claude Code はログイン情報を HOME 以下や OS のキーチェーンから読むため、
 * 環境変数は原則そのまま渡す。ただし、開発中に Claude Code の中から
 * 起動したときに紛れ込む入れ子用の変数だけは落としておく。
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, LANG: process.env.LANG ?? 'C.UTF-8' }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key === 'CLAUDE_PID') {
      delete env[key]
    }
  }
  // 効き方が読めなくなるので、効力の指定は引数側に一本化する。
  delete env.CLAUDE_EFFORT
  return env
}

function buildArgs(opts: RunOptions): string[] {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    // 履歴はこちらの jsonl で持つので、CLI 側のセッションは残さない。
    '--no-session-persistence',
    '--permission-mode',
    opts.permissionMode ?? 'dontAsk',
    '--model',
    opts.model ?? config.claudeModel,
  ]

  if (opts.addDirs?.length) args.push('--add-dir', ...opts.addDirs)
  if (config.claudeEffort) args.push('--effort', config.claudeEffort)
  if (opts.appendSystemPrompt) args.push('--append-system-prompt', opts.appendSystemPrompt)

  if (opts.allowedTools?.length) args.push('--allowed-tools', opts.allowedTools.join(','))

  const denied = [...new Set([...ALWAYS_DENIED, ...(opts.disallowedTools ?? [])])]
  args.push('--disallowed-tools', denied.join(','))

  return args
}

/**
 * Claude Code をワンショットで起動して、本文の差分と最終結果を流す。
 * プロンプトは履歴を含んで長くなるので、引数ではなく標準入力から渡す。
 */
export async function* runClaude(opts: RunOptions): AsyncGenerator<RunnerEvent> {
  const queue = new EventQueue<RunnerEvent>()

  const child = spawn(config.claudeBin, buildArgs(opts), {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv(),
  })

  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
  }, config.requestTimeoutMs)

  const onAbort = () => child.kill('SIGTERM')
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    // 上限を設けないと、暴走時にメモリを持っていかれる。
    if (stderr.length < 8_000) stderr += chunk
  })

  let finalText = ''
  let sessionId: string | null = null
  let costUsd: number | null = null
  let sawResult = false

  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    if (!line.trim()) return

    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      return // 想定外の行は捨てる
    }

    if (event.type === 'stream_event') {
      const inner = event.event as { type?: string; delta?: { type?: string; text?: string } }
      // thinking_delta / input_json_delta は本文ではないので拾わない。
      if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
        queue.push({ type: 'delta', text: inner.delta.text ?? '' })
      }
      return
    }

    if (event.type === 'result') {
      sawResult = true
      sessionId = (event.session_id as string) ?? null
      costUsd = (event.total_cost_usd as number) ?? null
      if (event.is_error) {
        queue.finish(new Error(String(event.result ?? 'Claude Code がエラーを返しました')))
        return
      }
      finalText = String(event.result ?? '')
    }
  })

  child.on('error', (error) => {
    queue.finish(new Error(`Claude Code を起動できませんでした: ${error.message}`))
  })

  child.on('close', (code, signal) => {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)

    if (signal) {
      queue.finish(new Error(signal === 'SIGTERM' ? '応答が時間内に終わりませんでした' : `中断されました (${signal})`))
      return
    }
    if (code !== 0 || !sawResult) {
      queue.finish(new Error(stderr.trim() || `Claude Code が異常終了しました (code ${code})`))
      return
    }

    queue.push({ type: 'done', text: finalText, sessionId, costUsd })
    queue.finish()
  })

  child.stdin.end(opts.prompt, 'utf8')

  yield* queue.drain()
}
