import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Summary, SummaryEvent } from '../../shared/types'
import { collectAgent, resolveModel, resolveSummaryModel, unfence } from '../agent'
import { groupSummaryPrompt, summaryPrompt, summarySystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { readJson, readText } from '../lib/body'
import { sse } from '../lib/sse'
import { readRecent } from '../store/log'
import {
  isGroupRef,
  topicDir,
  topicRef,
  type TopicName,
  type VerifiedTopicRef,
  type UserName,
} from '../store/paths'
import {
  readChildSources,
  readGroupSummary,
  readSummary,
  readTopic,
  writeSummary,
} from '../store/topic'
import { requireTopic, topicPaths } from './target'

export const summary = new Hono()

/**
 * 要約そのものの読み書き。書き換えるのはここだけで、AI には触らせない。
 */
summary.on('GET', topicPaths('/summary'), async (c) => {
  const { user, ref } = await requireTopic(c)
  return c.json<Summary>({ summary: await readSummary(user, ref) })
})

summary.on('PUT', topicPaths('/summary'), async (c) => {
  const { user, ref } = await requireTopic(c)
  const summaryText = await readText(c.req.raw, 'summary')
  await writeSummary(user, ref, summaryText)
  return c.json<Summary>({ summary: await readSummary(user, ref) })
})

/**
 * 要約の下書きを作る。ファイルは書き換えず、新しい summary.md の全文を流すだけ。
 * 保存は画面で確かめたあと PUT で行う。
 */
summary.on('POST', topicPaths('/summary'), async (c) => {
  const { user, ref } = await requireTopic(c)

  const meta = await readTopic(user, ref)
  const days = Math.max(config.contextDays, 14)
  const isGroup = isGroupRef(ref)

  // 器は自分では話さない。中のトピックの記録から共有の前提を拾う。
  const prompt = isGroup
    ? await groupDraftPrompt(user, ref.topic, meta.name, days)
    : await topicDraftPrompt(user, ref, meta.name, days)

  // 画面から指定が来ればそれを使う。無ければ .env の既定に落ちる。
  const body = await readJson<{ engine?: string; model?: string }>(c.req.raw)
  const choice = body.engine
    ? resolveModel(body.engine, body.model)
    : resolveSummaryModel()

  const release = await limiter.acquire(user)

  return streamSSE(c, async (stream) => {
    const send = sse<SummaryEvent>(stream)

    try {
      const text = await collectAgent(
        choice,
        {
          cwd: topicDir(user, ref),
          prompt,
          systemPrompt: summarySystemPrompt({ user, topicName: meta.name, isGroup }),
          signal: c.req.raw.signal,
        },
        {
          onDelta: async (delta) => {
            await send({ type: 'delta', text: delta })
          },
          onActivity: async (label) => {
            await send({ type: 'activity', label })
          },
        },
      )

      await send({ type: 'done', text: unfence(text), modelLabel: choice.label })
    } catch (error) {
      console.error('[summary]', error)
      await send({
        type: 'error',
        message: error instanceof Error ? error.message : '要約を整理できませんでした',
      }).catch(() => {})
    } finally {
      release()
    }
  })
})

async function topicDraftPrompt(
  user: UserName,
  ref: VerifiedTopicRef,
  topicName: string,
  days: number,
): Promise<string> {
  const history = await readRecent(user, ref, days)
  if (history.length === 0) {
    throw new BadRequestError('まだ記録がありません')
  }
  return summaryPrompt({
    history,
    topicName,
    summary: await readSummary(user, ref),
    groupSummary: await readGroupSummary(user, ref),
  })
}

async function groupDraftPrompt(
  user: UserName,
  topic: TopicName,
  topicName: string,
  days: number,
): Promise<string> {
  const children = await readChildSources(user, topic, days)
  if (children.every((child) => child.history.length === 0)) {
    throw new BadRequestError('中のトピックでまだ話していないよ')
  }
  return groupSummaryPrompt({
    topicName,
    summary: await readSummary(user, topicRef(topic)),
    children,
  })
}
