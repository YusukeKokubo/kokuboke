import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import type { SummaryEvent } from '../../shared/types'
import { resolveModel, runAgent } from '../agent'
import { summaryPrompt, summarySystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { readRecent } from '../store/log'
import { assertTopicSlug, assertUser, topicDir, userDir } from '../store/paths'
import { readPersona, readTopic, topicExists } from '../store/topic'

export const summary = new Hono()

/**
 * summary.md と profile.md の更新。会話と違ってファイルを書き換えるので、
 * 触れる範囲をユーザーのフォルダに限る。
 */
summary.post('/api/users/:user/topics/:topic/summary', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicSlug(c.req.param('topic'))

  if (!(await topicExists(user, topic))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }

  const meta = await readTopic(user, topic)
  // 要約は当日だけでなく、もう少し広めに読む。
  const history = await readRecent(user, topic, Math.max(config.contextDays, 14))

  if (history.length === 0) {
    throw new HTTPException(400, { message: 'まだ記録がありません' })
  }

  // 要約は書き換えを伴うので、権限を細かく絞れる方を既定にする。
  // トピックが cursor を選んでいる場合だけそちらを使う。
  const choice =
    meta.engine === 'cursor'
      ? resolveModel('cursor', meta.model)
      : resolveModel('claude', config.summaryModel)

  const persona = await readPersona(user, topic)
  const release = await limiter.acquire(user)

  return streamSSE(c, async (stream) => {
    const send = (event: SummaryEvent) => stream.writeSSE({ data: JSON.stringify(event) })

    try {
      const events = runAgent(choice, {
        cwd: topicDir(user, topic),
        prompt: summaryPrompt({ history, topicName: meta.name }),
        systemPrompt: summarySystemPrompt({ user, topicName: meta.name }),
        persona,
        task: 'summary',
        // profile.md は 2 つ上の階層にあるので、ユーザーフォルダごと許可する。
        addDirs: [userDir(user)],
        signal: c.req.raw.signal,
      })

      for await (const event of events) {
        if (event.type === 'delta') await send({ type: 'delta', text: event.text })
      }
      await send({ type: 'done' })
    } catch (error) {
      console.error('[summary]', error)
      await send({
        type: 'error',
        message: error instanceof Error ? error.message : '記憶を更新できませんでした',
      }).catch(() => {})
    } finally {
      release()
    }
  })
})
