import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import type { Summary, SummaryEvent, TopicRef } from '../../shared/types'
import { resolveModel, runAgent } from '../agent'
import { groupSummaryPrompt, summaryPrompt, summarySystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { readJson } from '../lib/body'
import { readRecent } from '../store/log'
import { topicDir } from '../store/paths'
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

  const body = await readJson<{ summary?: string }>(c.req.raw)
  if (typeof body.summary !== 'string') {
    throw new HTTPException(400, { message: '保存する内容がありません' })
  }

  await writeSummary(user, ref, body.summary)
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
  const isGroup = !ref.sub

  // 器は自分では話さない。中のトピックの記録から共有の前提を拾う。
  const prompt = isGroup
    ? await groupDraftPrompt(user, ref.topic, meta.name, days)
    : await topicDraftPrompt(user, ref, meta.name, days)

  // 画面から指定が来ればそれを使う。無ければ .env の既定に落ちる。
  const body = await readJson<{ engine?: string; model?: string }>(c.req.raw)
  const choice = body.engine
    ? resolveModel(body.engine, body.model)
    : config.summaryEngine === 'cursor'
      ? resolveModel('cursor', config.cursorModel)
      : resolveModel('claude', config.summaryModel)

  const release = await limiter.acquire(user)

  return streamSSE(c, async (stream) => {
    const send = (event: SummaryEvent) => stream.writeSSE({ data: JSON.stringify(event) })

    try {
      const events = runAgent(choice, {
        cwd: topicDir(user, ref),
        prompt,
        systemPrompt: summarySystemPrompt({ user, topicName: meta.name, group: isGroup }),
        signal: c.req.raw.signal,
      })

      let text = ''
      for await (const event of events) {
        if (event.type === 'delta') {
          text += event.text
          await send({ type: 'delta', text: event.text })
        }
        if (event.type === 'done') text = event.text
      }

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
  user: string,
  ref: TopicRef,
  topicName: string,
  days: number,
): Promise<string> {
  const history = await readRecent(user, ref, days)
  if (history.length === 0) {
    throw new HTTPException(400, { message: 'まだ記録がありません' })
  }
  return summaryPrompt({
    history,
    topicName,
    summary: await readSummary(user, ref),
    groupSummary: await readGroupSummary(user, ref),
  })
}

async function groupDraftPrompt(
  user: string,
  topic: string,
  topicName: string,
  days: number,
): Promise<string> {
  const children = await readChildSources(user, topic, days)
  if (children.every((child) => child.history.length === 0)) {
    throw new HTTPException(400, { message: '中のトピックでまだ話していないよ' })
  }
  return groupSummaryPrompt({
    topicName,
    summary: await readSummary(user, { topic }),
    children,
  })
}

/**
 * 本文だけを返すよう頼んでも、全体をコードブロックで囲んでくることがある。
 * 中身が丸ごと囲まれている場合だけ剥がす。文中のコードブロックには触らない。
 */
export function unfence(text: string): string {
  const body = text.trim()
  const match = /^```[^\n]*\n([\s\S]*)\n```$/.exec(body)
  if (!match) return body
  // 途中で閉じて開き直している場合は、囲みではなく本文の一部。
  return match[1].includes('```') ? body : match[1]
}
