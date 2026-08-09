import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ENGINES } from '../agent'
import { readJson } from '../lib/body'
import { TOPIC_TEMPLATES } from '../templates'
import { assertTopicName, assertUser } from '../store/paths'
import { createTopic, listTopics, readTopic, topicExists, updateTopic } from '../store/topic'

export const topics = new Hono()

topics.get('/api/templates', (c) => c.json(TOPIC_TEMPLATES))
topics.get('/api/engines', (c) => c.json(ENGINES))

topics.get('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json(await listTopics(user))
})

topics.post('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))
  const body = await readJson<{
    name?: string
    emoji?: string
    template?: string
    engine?: string
    model?: string
  }>(c.req.raw)

  const topic = await createTopic(user, {
    name: String(body.name ?? ''),
    emoji: body.emoji,
    template: body.template,
    engine: body.engine,
    model: body.model,
  })

  return c.json(topic, 201)
})

topics.get('/api/users/:user/topics/:topic', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicName(c.req.param('topic'))

  if (!(await topicExists(user, topic))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }
  return c.json(await readTopic(user, topic))
})

topics.patch('/api/users/:user/topics/:topic', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicName(c.req.param('topic'))

  if (!(await topicExists(user, topic))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }

  const body = await readJson<{ engine?: string; model?: string }>(c.req.raw)
  return c.json(await updateTopic(user, topic, body))
})
