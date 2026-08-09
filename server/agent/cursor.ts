import { config } from '../config'
import { runProcess } from './process'
import type { AgentEvent, Engine, RunRequest } from './types'

function args(request: RunRequest): string[] {
  const summary = request.task === 'summary'

  const list = [
    '--print',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    // 作業ディレクトリはこちらが用意したものなので、確認を求められても困る。
    '--trust',
    '--model',
    request.model,
  ]

  if (summary) {
    // cursor-agent には Claude Code のようなツール単位の許可リストがない。
    // 書き換えを伴う要約では --force で通すしかなく、粒度はこちらの方が粗い。
    list.push('--force')
  } else {
    // ask モードは読み取り専用。ファイル作成もシェル実行も拒否される。
    list.push('--mode', 'ask')
  }

  if (request.addDirs?.length) {
    for (const dir of request.addDirs) list.push('--add-dir', dir)
  }

  return list
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

  run(request: RunRequest): AsyncGenerator<AgentEvent> {
    let finalText = ''
    let finished = false
    let error: string | null = null

    return runProcess({
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
