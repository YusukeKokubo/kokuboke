import { Hono } from 'hono'
import type { AgentRun, LogEntry, SummaryEvent } from '../../shared/types'
import type { ConsultTurn } from '../../shared/tag-consult'
import { resolveModel } from '../agent'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { agentRuns, serverLog } from '../diagnostic/log'
import { diagnosePrompt, diagnoseSystemPrompt } from '../diagnostic/prompt'
import { BadRequestError } from '../errors'
import { streamAgent } from '../lib/agent-stream'
import { readJson } from '../lib/body'
import { adminGuard } from './admin'

/**
 * 診断の画面。管理画面と同じ鍵で守る。見せるのはサーバーのログと CLI の時間で、
 * 家族の会話の中身は出さない。
 */
export const diagnostic = new Hono()

diagnostic.use('/api/diagnostic/*', adminGuard)

diagnostic.get('/api/diagnostic/logs', (c) => c.json<{ entries: LogEntry[] }>({ entries: serverLog.list() }))

diagnostic.get('/api/diagnostic/runs', (c) => c.json<{ runs: AgentRun[] }>({ runs: agentRuns.list() }))

/** 家族のユーザー名とはぶつからない札。診断は一度に一つだけ走らせる。 */
const BUSY_KEY = ':diagnostic'
const MAX_TURNS = 40

function asTurns(raw: unknown): ConsultTurn[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (turn): turn is ConsultTurn =>
        !!turn &&
        typeof turn === 'object' &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.text === 'string',
    )
    .slice(-MAX_TURNS)
}

/**
 * AI に聞く。やり取りは画面が持っていて、毎回丸ごと送ってくる（どこにも保存しない）。
 * ソースを探して読めるよう、読み取りの道具を足して Claude Code で走らせる。
 */
diagnostic.post('/api/diagnostic/ask', async (c) => {
  const body = await readJson<{ turns?: unknown }>(c.req.raw)
  const turns = asTurns(body.turns)
  if (turns.at(-1)?.role !== 'user') throw new BadRequestError('聞くことが空です')

  const choice = resolveModel('claude')
  const release = await limiter.acquire(BUSY_KEY)

  return streamAgent<SummaryEvent>(c, {
    choice,
    cwd: config.sourceDir,
    prompt: diagnosePrompt({
      now: new Date().toISOString(),
      commit: config.appCommit || null,
      logs: serverLog.list(),
      runs: agentRuns.list(),
      turns,
    }),
    systemPrompt: diagnoseSystemPrompt({ sourceDir: config.sourceDir, logDir: config.logDir }),
    extraTools: ['Grep', 'Glob'],
    release,
    tag: 'diagnose',
    fallback: '診断の返事を書けませんでした',
    close: (text, send) => send({ type: 'done', text, modelLabel: choice.label }),
  })
})
