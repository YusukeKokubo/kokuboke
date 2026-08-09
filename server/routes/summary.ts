import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import type { SummaryEvent } from '../../shared/types'
import { summaryPrompt, summarySystemPrompt } from '../claude/prompt'
import { limiter } from '../claude/queue'
import { runClaude } from '../claude/runner'
import { config } from '../config'
import { readRecent } from '../store/log'
import { assertTopicSlug, assertUser, topicDir, userDir } from '../store/paths'
import { readTopicMeta, topicExists } from '../store/topic'

export const summary = new Hono()

/**
 * summary.md と profile.md の更新。会話と違ってファイルを書き換えるので、
 * 書き込み系のツールを許可した上で、触れる範囲をユーザーのフォルダに限る。
 */
summary.post('/api/users/:user/topics/:topic/summary', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicSlug(c.req.param('topic'))

  if (!(await topicExists(user, topic))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }

  const meta = await readTopicMeta(user, topic)
  // 要約は当日だけでなく、もう少し広めに読む。
  const history = await readRecent(user, topic, Math.max(config.contextDays, 14))

  if (history.length === 0) {
    throw new HTTPException(400, { message: 'まだ記録がありません' })
  }

  const release = await limiter.acquire(user)

  return streamSSE(c, async (stream) => {
    const send = (event: SummaryEvent) => stream.writeSSE({ data: JSON.stringify(event) })

    try {
      const events = runClaude({
        cwd: topicDir(user, topic),
        prompt: summaryPrompt({ history, topicName: meta.name }),
        appendSystemPrompt: summarySystemPrompt({ user, topicName: meta.name }),
        allowedTools: ['Read', 'Write', 'Edit'],
        // profile.md は 2 つ上の階層にあるので、ユーザーフォルダごと許可する。
        addDirs: [userDir(user)],
        permissionMode: 'acceptEdits',
        model: config.summaryModel,
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
