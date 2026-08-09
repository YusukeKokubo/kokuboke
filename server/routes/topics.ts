import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { TOPIC_TEMPLATES } from '../templates'
import { assertTopicSlug, assertUser } from '../store/paths'
import { createTopic, listTopics, readTopicMeta, topicExists } from '../store/topic'

export const topics = new Hono()

topics.get('/api/templates', (c) => c.json(TOPIC_TEMPLATES))

topics.get('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json(await listTopics(user))
})

topics.post('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))

  const body = await c.req.json<{ name?: string; emoji?: string; template?: string }>().catch(() => {
    throw new HTTPException(400, { message: 'リクエストの形式が不正です' })
  })

  const topic = await createTopic(user, {
    name: String(body.name ?? ''),
    emoji: body.emoji,
    template: body.template,
  })

  return c.json(topic, 201)
})

topics.get('/api/users/:user/topics/:topic', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicSlug(c.req.param('topic'))

  if (!(await topicExists(user, topic))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }
  return c.json(await readTopicMeta(user, topic))
})
