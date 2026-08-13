import { config } from '../config'
import { cursorActivity } from './activity'
import { ensureWebSearchApproved } from './cursor-config'
import { runProcess } from './process'
import type { AgentEvent, Engine, RunRequest } from './types'

function args(request: RunRequest): string[] {
  // ask モードは読み取り専用。ファイル作成もシェル実行も、道具そのものが無い。
  // cursor-agent にはツール単位の許可リストが無いので、守りはこのモードだけが頼り。
  // 要約の整理も読み取りだけで済ませることで、そこに触れずに済ませている。
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

/**
 * assistant の行の見分け。
 *
 * 道具を挟むと本文はいくつかの区切りに分かれ、区切りの終わりに、そこまでの差分を
 * 丸ごと繰り返した言い直しが一つ届く。「timestamp_ms が無いのが完成形」が当てはまるのは
 * いちばん最後の区切りだけで、途中の区切りの言い直しは差分と同じ形のまま来る
 * （キーも中身の並びも変わらない。2026.08.11-e8db854 で確認）。見分けずに全部つなぐと、
 * 道具を使った回だけ前半が二重になる。
 *
 * 頼れるのは「それまで流した分と丸ごと同じ」という形だけなので、そこで見分ける。
 * ただし短い区切りでは、たまたま同じ文字が続いただけの差分とも区別が付かない。
 * そこで、ここでは repeat（言い直しかもしれない）と告げるにとどめ、続く行を見て
 * 呼び出し側が決める。言い直しなら次に来るのは道具か終わりで、差分なら次も差分になる。
 */
export type AssistantKind = 'delta' | 'complete' | 'repeat'

export function assistantSegment(
  line: Record<string, unknown>,
  /** 今の区切りでそこまでに流した分。 */
  pending: string,
): { kind: AssistantKind; text: string } {
  const message = line.message as { content?: Array<{ type?: string; text?: string }> } | undefined
  const text = (message?.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('')

  if (line.timestamp_ms === undefined || line.model_call_id !== undefined) {
    return { kind: 'complete', text }
  }
  if (text !== '' && text === pending) return { kind: 'repeat', text }
  return { kind: 'delta', text }
}

export const cursorAgent: Engine = {
  id: 'cursor',

  async *run(request: RunRequest): AsyncGenerator<AgentEvent> {
    // ログインし直したあとは設定が既定に戻っていることがあるので、
    // 起動のたびに確かめる。立っていれば読むだけで済む。
    await ensureWebSearchApproved()

    /** 閉じた区切りをつないだもの。 */
    let segments = ''
    /** 今の区切りでそこまでに流した分。 */
    let pending = ''
    /** 言い直しかもしれないので、次の行が来るまで流さずに預かっている分。 */
    let held: string | null = null
    let resultText = ''
    let finished = false
    let error: string | null = null

    /** 預かった分は言い直しではなかった。今からでも流す。 */
    const flushHeld = (emit: (event: AgentEvent) => void): void => {
      if (held === null) return
      pending += held
      emit({ type: 'delta', text: held })
      held = null
    }

    /** 区切りを閉じる。預かった分は言い直しだったので捨てる。 */
    const closeSegment = (text: string): void => {
      segments += text || pending
      pending = ''
      held = null
    }

    yield* runProcess({
      bin: config.cursorBin,
      args: args(request),
      cwd: request.cwd,
      stdin: buildPrompt(request),
      signal: request.signal,

      onLine(line, emit) {
        if (line.type === 'assistant') {
          const segment = assistantSegment(line, pending)

          // 最後の区切りの完成形。本文はこちらの言い方を採る。
          if (segment.kind === 'complete') {
            closeSegment(segment.text)
            return
          }
          // 言い直しらしい。次の行を見るまで決めずに預かる。
          if (segment.kind === 'repeat') {
            flushHeld(emit)
            held = segment.text
            return
          }
          // 差分が続いたということは、預かっていた分は言い直しではなかった。
          flushHeld(emit)
          if (segment.text) {
            pending += segment.text
            emit({ type: 'delta', text: segment.text })
          }
          return
        }

        // 読み込みや検索は数秒かかる。何をしているかを横に流して、
        // 一文字目が来るまでのあいだ画面が黙り込まないようにする。
        if (line.type === 'tool_call' && line.subtype === 'started') {
          // 道具に移ったということは、預かっていた分は区切りの言い直しだった。
          if (held !== null) closeSegment('')
          const label = cursorActivity((line.tool_call ?? {}) as Record<string, unknown>)
          if (label) emit({ type: 'activity', label })
          return
        }

        if (line.type === 'result') {
          finished = true
          if (held !== null) closeSegment('')
          if (line.is_error) {
            error = String(line.result ?? 'cursor-agent がエラーを返しました')
            return
          }
          resultText = String(line.result ?? '')
        }
      },

      // 閉じ切らずに終わった区切りも本文に含める。
      // 拾えたものが何も無いときだけ result に頼る（result が持っているのは
      // 最後の区切りだけなので、道具を挟んだ回はこれだと前置きが落ちる）。
      finalText: () => segments + pending || resultText,
      finished: () => finished,
      reportedError: () => error,
    })
  },
}
