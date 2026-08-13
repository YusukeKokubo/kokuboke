import { config } from '../config'
import { claudeActivity } from './activity'
import { runProcess } from './process'
import type { AgentEvent, Engine, RunRequest } from './types'

/** 明示的に禁止しておくツール。許可リストだけに頼らず二重に塞ぐ。 */
const ALWAYS_DENIED = ['Bash', 'Task', 'WebFetch', 'WebSearch', 'NotebookEdit', 'KillShell', 'BashOutput']

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
    '--allowed-tools',
    'Read',
    '--disallowed-tools',
    ALWAYS_DENIED.join(','),
  ]

  if (config.claudeEffort) list.push('--effort', config.claudeEffort)

  return list
}

/** CLAUDE.md は作業ディレクトリから親まで遡って CLI 側が自分で読む。 */
export const claudeCode: Engine = {
  id: 'claude',

  run(request: RunRequest): AsyncGenerator<AgentEvent> {
    let finalText = ''
    let finished = false
    let error: string | null = null

    return runProcess({
      bin: config.claudeBin,
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
