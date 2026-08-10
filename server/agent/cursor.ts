import { config } from '../config'
import { ensureWebSearchApproved } from './cursor-config'
import { runProcess } from './process'
import type { AgentEvent, Engine, RunRequest } from './types'

function args(request: RunRequest): string[] {
  // ask モードは読み取り専用。ファイル作成もシェル実行も、道具そのものが無い。
  // cursor-agent にはツール単位の許可リストが無いので、守りはこのモードだけが頼り。
  // 記憶の整理も読み取りだけで済ませることで、そこに触れずに済ませている。
  return [
    '--print',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    // 作業ディレクトリはこちらが用意したものなので、確認を求められても困る。
    '--trust',
    '--mode',
    'ask',
    // ヘッドレスでもページ取得のたびに承認を求められ、答える人がいないので
    // 既定では即 User Rejected になる。取得を通す道はこれだけで、
    // permissions の許可リストは --print の経路では見ていない。
    //
    // 何でも通す名前だが、開くのは ask モードが持っている道具に限られる。
    // 書き込みもシェルも最初から無いので、増えるのはウェブの読み取りだけ。
    // ついでに --sandbox が無効になるが、そこに頼っていた守りは元から無い。
    '--force',
    '--model',
    request.model,
  ]
}

/**
 * cursor-agent には --append-system-prompt が無いので、役割の指示は本文の先頭に積む。
 * 人格の定義は AGENTS.md（CLAUDE.md へのリンク）を親まで遡って自分で読む。
 */
function buildPrompt(request: RunRequest): string {
  return `<instructions>\n${request.systemPrompt}\n</instructions>\n\n${request.prompt}`
}

export const cursorAgent: Engine = {
  id: 'cursor',

  async *run(request: RunRequest): AsyncGenerator<AgentEvent> {
    // ログインし直したあとは設定が既定に戻っていることがあるので、
    // 起動のたびに確かめる。立っていれば読むだけで済む。
    await ensureWebSearchApproved()

    let finalText = ''
    let finished = false
    let error: string | null = null

    yield* runProcess({
      bin: config.cursorBin,
      args: args(request),
      cwd: request.cwd,
      stdin: buildPrompt(request),
      signal: request.signal,

      onLine(line, emit) {
        if (line.type === 'assistant') {
          // 差分には timestamp_ms が付き、最後に届く完成形には付かない。
          // 見分けずに全部つなぐと本文が二重になる。
          if (line.timestamp_ms === undefined) return

          const message = line.message as { content?: Array<{ type?: string; text?: string }> }
          for (const block of message?.content ?? []) {
            if (block.type === 'text' && block.text) emit({ type: 'delta', text: block.text })
          }
          return
        }

        if (line.type === 'result') {
          finished = true
          if (line.is_error) {
            error = String(line.result ?? 'cursor-agent がエラーを返しました')
            return
          }
          finalText = String(line.result ?? '')
        }
      },

      finalText: () => finalText,
      finished: () => finished,
      reportedError: () => error,
    })
  },
}
