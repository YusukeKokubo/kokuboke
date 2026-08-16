import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ENGINES } from '../agent'
import { applyAutoName, applyAutoTag } from '../agent/auto'
import { limiter } from '../agent/queue'
import { BadRequestError } from '../errors'
import { readJson } from '../lib/body'
import { readFamilyActivity } from '../store/activity'
import { ensureTag } from '../store/tag'
import {
  createTopic,
  deleteTopic,
  listTopics,
  readTopic,
  renameTopic,
  shouldAutoName,
  shouldAutoTag,
  updateTopic,
  writeTags,
} from '../store/topic'
import { requireTopic, resolveSpace, spacePaths, topicPaths } from './space'

export const topics = new Hono()

topics.get('/api/engines', (c) => c.json(ENGINES))

topics.get('/api/family/activity', async (c) => c.json({ entry: await readFamilyActivity() }))

topics.on('GET', spacePaths('/topics'), async (c) => {
  return c.json(await listTopics(resolveSpace(c).user))
})

topics.on('POST', spacePaths('/topics'), async (c) => {
  const { user } = resolveSpace(c)
  const body = await readJson<{ name?: string; engine?: string; model?: string }>(c.req.raw)
  return c.json(
    await createTopic(user, {
      name: String(body.name ?? ''),
      engine: body.engine,
      model: body.model,
    }),
    201,
  )
})

topics.on('GET', topicPaths(), async (c) => {
  const { space, id } = await requireTopic(c)
  return c.json(await readTopic(space.user, id))
})

topics.on('PATCH', topicPaths('/name'), async (c) => {
  const { space, id } = await requireTopic(c)
  const body = await readJson<{ name?: string }>(c.req.raw)
  if (typeof body.name !== 'string') {
    throw new BadRequestError('名前を入力してください')
  }
  const release = await limiter.acquire(space.busyKey(id))
  try {
    return c.json(await renameTopic(space.user, id, { name: body.name }))
  } finally {
    release()
  }
})

topics.on('PATCH', topicPaths('/model'), async (c) => {
  const { space, id } = await requireTopic(c)
  const body = await readJson<{ engine?: string; model?: string }>(c.req.raw)
  return c.json(await updateTopic(space.user, id, body))
})

topics.on('PATCH', topicPaths('/tags'), async (c) => {
  const { space, id } = await requireTopic(c)
  const body = await readJson<{ tags?: unknown }>(c.req.raw)
  if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
    throw new BadRequestError('タグの指定が不正です')
  }
  const names: string[] = []
  for (const raw of body.tags as string[]) {
    const tag = await ensureTag(space.user, raw)
    if (tag) names.push(tag)
  }
  return c.json(await writeTags(space.user, id, [...new Set(names)]))
})

topics.on('DELETE', topicPaths(), async (c) => {
  const { space, id } = await requireTopic(c)
  if (limiter.isBusy(space.busyKey(id))) {
    throw new HTTPException(409, { message: '前の返答をまだ書いています' })
  }
  await deleteTopic(space.user, id)
  return c.body(null, 204)
})

topics.on('POST', topicPaths('/name'), async (c) => {
  const { space, id } = await requireTopic(c)
  const release = await limiter.acquireWhenFree(space.busyKey(id))
  try {
    if (!(await shouldAutoName(space.user, id))) {
      return c.json(await readTopic(space.user, id))
    }
    return c.json(await applyAutoName(space.user, id))
  } finally {
    release()
  }
})

topics.on('POST', topicPaths('/tags'), async (c) => {
  const { space, id } = await requireTopic(c)
  const release = await limiter.acquireWhenFree(space.busyKey(id))
  try {
    if (!(await shouldAutoTag(space.user, id))) {
      return c.json(await readTopic(space.user, id))
    }
    return c.json(await applyAutoTag(space.user, id))
  } finally {
    release()
  }
})
