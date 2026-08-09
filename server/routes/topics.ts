import { Hono } from 'hono'
import { ENGINES } from '../agent'
import { readJson } from '../lib/body'
import { TOPIC_TEMPLATES } from '../templates'
import { assertTopicName, assertUser } from '../store/paths'
import { createTopic, listChildren, listTopics, readTopic, updateTopic } from '../store/topic'
import { requireTopic, topicPaths } from './target'

export const topics = new Hono()

interface CreateBody {
  name?: string
  emoji?: string
  template?: string
  engine?: string
  model?: string
}

topics.get('/api/templates', (c) => c.json(TOPIC_TEMPLATES))
topics.get('/api/engines', (c) => c.json(ENGINES))

topics.get('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json(await listTopics(user))
})

topics.post('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))
  const body = await readJson<CreateBody>(c.req.raw)

  const topic = await createTopic(user, {
    name: String(body.name ?? ''),
    emoji: body.emoji,
    template: body.template,
    engine: body.engine,
    model: body.model,
  })

  return c.json(topic, 201)
})

/** トピックの中をさらに分ける。作れるのは一段までなので、子の下には作れない。 */
topics.post('/api/users/:user/topics/:topic/sub', async (c) => {
  const user = assertUser(c.req.param('user'))
  const parent = assertTopicName(c.req.param('topic'))
  const body = await readJson<CreateBody>(c.req.raw)

  const topic = await createTopic(
    user,
    {
      name: String(body.name ?? ''),
      emoji: body.emoji,
      template: body.template,
      engine: body.engine,
      model: body.model,
    },
    parent,
  )

  return c.json(topic, 201)
})

topics.on('GET', topicPaths(), async (c) => {
  const { user, ref } = await requireTopic(c)

  const topic = await readTopic(user, ref)
  if (!ref.sub) topic.children = await listChildren(user, ref.topic)

  return c.json(topic)
})

topics.on('PATCH', topicPaths(), async (c) => {
  const { user, ref } = await requireTopic(c)
  const body = await readJson<{ engine?: string; model?: string }>(c.req.raw)
  return c.json(await updateTopic(user, ref, body))
})
