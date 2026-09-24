import type { AgentRun, LogEntry } from '../../shared/types'
import type { ConsultTurn } from '../../shared/tag-consult'

/** プロンプトに直に載せる分。これより古いものはファイルを読ませる。 */
const RECENT_LOGS = 200
const RECENT_RUNS = 60
const MAX_TURN_CHARS = 40_000

export function diagnoseSystemPrompt(input: { sourceDir: string; logDir: string }): string {
  return `あなたは kokuboke（家族向けの AI チャットのサーバー）の不具合や遅さを調べる係です。
相手はこのサーバーを運用している開発者で、スマートフォンから聞いています。

- ソースは ${input.sourceDir} にあります。AGENTS.md と README.md、docs/ に経緯がまとまっています。
- ログは ${input.logDir} にあります。server.jsonl がサーバーのログ、agent-runs.jsonl が
  CLI を一回走らせるごとの時間の記録です。上限を超えた古い分は、同じ名前の末尾に .1 を付けたファイルにあります。
- 読むだけです。ファイルは書き換えず、コマンドも走らせません。直し方は、変える場所と中身を示すところまでにします。
- 家族の会話そのもの（data の下のトピック）は読まないでください。ログにあるトピックの id と時刻だけで追います。
- 推測で結論を出さないでください。ログの行やソースの箇所を根拠に挙げ、足りなければ何を測れば分かるかを言います。
- 話し言葉で短く返してください。「承知しました」のような前置きや、返答の要約は書きません。`
}

function renderRun(run: AgentRun): string {
  const ms = (value: number | null) => (value === null ? '-' : `${value}ms`)
  const label = [run.engine, run.model, run.effort].filter(Boolean).join('/')
  return `${run.at} ${label} init=${ms(run.initMs)} first=${ms(run.firstMs)} total=${ms(run.totalMs)} tools=${run.tools} ${run.exit}`
}

function renderLog(entry: LogEntry): string {
  return `${entry.at} [${entry.level}] ${entry.text}`
}

function renderTurns(turns: ConsultTurn[]): string {
  const lines = turns.map((turn) => `${turn.role === 'user' ? '開発者' : 'あなた'}: ${turn.text.trim()}`)
  while (lines.join('\n\n').length > MAX_TURN_CHARS && lines.length > 1) lines.shift()
  return lines.join('\n\n')
}

export function diagnosePrompt(input: {
  now: string
  commit: string | null
  logs: LogEntry[]
  runs: AgentRun[]
  turns: ConsultTurn[]
}): string {
  const logs = input.logs.slice(-RECENT_LOGS)
  const runs = input.runs.slice(-RECENT_RUNS)

  return [
    `<server>\n今: ${input.now}\n動いている版: ${input.commit ?? '不明（イメージから起動していない）'}\n</server>`,
    `<agent-runs>\n${runs.map(renderRun).join('\n') || '（まだ記録がありません）'}\n</agent-runs>`,
    `<recent-logs>\n${logs.map(renderLog).join('\n') || '（まだ記録がありません）'}\n</recent-logs>`,
    `<conversation>\n${renderTurns(input.turns)}\n</conversation>`,
    '<conversation> の最後の発言に答えてください。上に載っているのは最近の分だけです。足りなければログのファイルとソースを読んでください。',
  ].join('\n\n')
}
