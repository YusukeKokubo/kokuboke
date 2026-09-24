import { format, stripVTControlCharacters } from 'node:util'
import type { AgentRun, LogEntry } from '../../shared/types'
import { Journal } from './journal'

/**
 * サーバーのログ。標準出力にはこれまでどおり出しつつ、同じ行をここにも残す。
 * コンテナの中からは `docker logs` が読めないので、診断の画面はこちらを見る。
 */
export const serverLog = new Journal<LogEntry>('server', 3000, 5 * 1024 * 1024)

/** CLI を一回走らせるごとの時間。`[agent]` の行と同じ中身を形のまま持つ。 */
export const agentRuns = new Journal<AgentRun>('agent-runs', 1000, 1024 * 1024)

const LEVELS = { log: 'log', info: 'log', warn: 'warn', error: 'error' } as const

/**
 * console を包んでログを受け始める。起動の最初に一度だけ呼ぶ。
 * テストでは呼ばないので、ファイルには何も書かれない。
 */
export function captureLogs(dir: string): void {
  const problems = [serverLog.open(dir), agentRuns.open(dir)].filter(Boolean)

  for (const method of Object.keys(LEVELS) as Array<keyof typeof LEVELS>) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => {
      original(...args)
      // hono の logger は状態の番号に色を付ける。ファイルと画面では読みにくいだけなので外す。
      const text = stripVTControlCharacters(format(...args))
      // hono の logger は受けたときと返したときの二行を出す。返した方に時間まで
      // 載っているので、受けた方は残さない（標準出力には出たまま）。
      if (text.startsWith('<-- ')) return
      // 死活確認は数秒おきに来て、枠を押し流すだけで手掛かりにならない。通った分は残さない。
      if (text.startsWith('--> GET /api/health 200 ')) return
      serverLog.push({ at: new Date().toISOString(), level: LEVELS[method], text })
    }
  }

  // 包んだあとに出すので、メモリの方には残って診断の画面で見える。
  for (const problem of problems) console.error('[log]', problem)
}
