import { config } from '../config'
import { claudeActivity } from './activity'
import { runProcess } from './process'
import type { AgentEvent, Engine, RunRequest } from './types'

/** 明示的に禁止しておくツール。許可リストだけに頼らず二重に塞ぐ。 */
const ALWAYS_DENIED = ['Bash', 'Task', 'NotebookEdit', 'KillShell', 'BashOutput']

function args(request: RunRequest): string[] {
  // 会話も要約の整理も読み取りだけで足りる。要約は AI に書かせず、
  // 返ってきた全文を人が確かめてからサーバーが保存する。
  const list = [
    '--print',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    // 履歴はこちらの jsonl で持つので、CLI 側のセッションは残さない。
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--model',
    request.model,
    '--append-system-prompt',
    request.systemPrompt,
    // 天気や営業時間みたいな鮮度が要る質問に答えられるよう、読み取り系の
    // WebSearch / WebFetch も許可する。--permission-mode dontAsk のままで
    // 確認プロンプトなしに通ることは実機で確認済み（cursor 側のような
    // 追加の許可設定は不要）。書き込み・実行系は ALWAYS_DENIED で塞いだまま。
    '--allowed-tools',
    ['Read', 'WebSearch', 'WebFetch', ...(request.extraTools ?? [])].join(','),
    '--disallowed-tools',
    ALWAYS_DENIED.join(','),
    // claude.ai でログインしていると、アカウントのコネクタ（Gmail や Slack など）を
    // 起動のたびに読みに行き、一文字目が 1〜2 秒遅れる。この用途では一つも使わない。
    '--strict-mcp-config',
  ]

  if (request.effort) list.push('--effort', request.effort)

  return list
}

/** 人格の AGENTS.md は作業ディレクトリから親まで遡って CLI 側が自分で読む（2.1.277 以降）。 */
export const claudeCode: Engine = {
  id: 'claude',

  run(request: RunRequest): AsyncGenerator<AgentEvent> {
    let finalText = ''
    let finished = false
    let error: string | null = null

    return runProcess({
      bin: config.claudeBin,
      meta: { engine: 'claude', model: request.model, effort: request.effort ?? null },
      args: args(request),
      cwd: request.cwd,
      stdin: request.prompt,
      signal: request.signal,

      onLine(line, emit) {
        if (line.type === 'stream_event') {
          const inner = line.event as {
            type?: string
            delta?: { type?: string; text?: string }
            content_block?: { type?: string; name?: string }
          }
          // thinking_delta / input_json_delta は本文ではないので拾わない。
          if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
            emit({ type: 'delta', text: inner.delta.text ?? '' })
            return
          }
          // 道具を使い始めたところ。何をしているかを横に流して、
          // 一文字目が来るまでのあいだ画面が黙り込まないようにする。
          if (inner?.type === 'content_block_start' && inner.content_block?.type === 'tool_use') {
            emit({ type: 'activity', label: claudeActivity(inner.content_block.name ?? '') })
          }
          return
        }

        if (line.type === 'result') {
          finished = true
          if (line.is_error) {
            error = String(line.result ?? 'Claude Code がエラーを返しました')
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
