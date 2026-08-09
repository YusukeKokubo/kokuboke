import { config } from '../config'
import { runProcess } from './process'
import type { AgentEvent, Engine, RunRequest } from './types'

/** 明示的に禁止しておくツール。許可リストだけに頼らず二重に塞ぐ。 */
const ALWAYS_DENIED = ['Bash', 'Task', 'WebFetch', 'WebSearch', 'NotebookEdit', 'KillShell', 'BashOutput']

function args(request: RunRequest): string[] {
  const summary = request.task === 'summary'

  const list = [
    '--print',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    // 履歴はこちらの jsonl で持つので、CLI 側のセッションは残さない。
    '--no-session-persistence',
    '--permission-mode',
    summary ? 'acceptEdits' : 'dontAsk',
    '--model',
    request.model,
    '--append-system-prompt',
    request.systemPrompt,
    '--allowed-tools',
    summary ? 'Read,Write,Edit' : 'Read',
    '--disallowed-tools',
    ALWAYS_DENIED.join(','),
  ]

  if (request.addDirs?.length) list.push('--add-dir', ...request.addDirs)
  if (config.claudeEffort) list.push('--effort', config.claudeEffort)

  return list
}

/**
 * Claude Code は作業ディレクトリの CLAUDE.md を親まで遡って自分で読むので、
 * persona は渡さない。
 */
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
          const inner = line.event as { type?: string; delta?: { type?: string; text?: string } }
          // thinking_delta / input_json_delta は本文ではないので拾わない。
          if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
            emit({ type: 'delta', text: inner.delta.text ?? '' })
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
