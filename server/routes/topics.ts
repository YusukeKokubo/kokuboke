import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { collectAgent, ENGINES, resolveModel } from '../agent'
import { parseName, parseTags } from '../agent/name'
import { namePrompt, nameSystemPrompt, tagPrompt, tagSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { readJson } from '../lib/body'
import { readFamilyActivity } from '../store/activity'
import { countUserMessages, readRecent } from '../store/log'
import { topicDir } from '../store/paths'
import { ensureTag, listTags } from '../store/tag'
import {
  createTopic,
  deleteTopic,
  listTopics,
  markNameTried,
  markTagTried,
  readTopic,
  renameTopic,
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
  const { user } = space
  const current = await readTopic(user, id)

  const history = await readRecent(user, id, Math.max(config.contextDays, 14))
  if (history.length === 0) {
    throw new BadRequestError('まだ記録がありません')
  }

  const choice = resolveModel(current.engine, current.model)
  const release = await limiter.acquire(space.busyKey(id))

  let text: string
  try {
    text = await collectAgent(choice, {
      cwd: topicDir(user, id),
      prompt: namePrompt({ history, currentName: current.name || undefined }),
      systemPrompt: nameSystemPrompt(),
      signal: c.req.raw.signal,
    })
  } catch (error) {
    console.error('[name]', error)
    text = ''
  }

  try {
    const proposed = parseName(text)
    if (!proposed) {
      await markNameTried(user, id)
      throw new HTTPException(502, { message: '名前を作れませんでした' })
    }

    const autoAt = await countUserMessages(user, id)
    return c.json(await renameTopic(user, id, { ...proposed, autoAt }))
  } finally {
    release()
  }
})

topics.on('POST', topicPaths('/tags'), async (c) => {
  const { space, id } = await requireTopic(c)
  const { user } = space
  const current = await readTopic(user, id)
  const history = await readRecent(user, id, Math.max(config.contextDays, 14))
  if (history.length === 0) {
    throw new BadRequestError('まだ記録がありません')
  }

  const known = (await listTags(user)).map((tag) => tag.name)
  const choice = resolveModel(current.engine, current.model)
  const release = await limiter.acquire(space.busyKey(id))

  let text: string
  try {
    text = await collectAgent(choice, {
      cwd: topicDir(user, id),
      prompt: tagPrompt({ history, known }),
      systemPrompt: tagSystemPrompt(),
      signal: c.req.raw.signal,
    })
  } catch (error) {
    console.error('[tags]', error)
    text = ''
  } finally {
    release()
  }

  const proposed = parseTags(text)
  if (proposed.length === 0) {
    await markTagTried(user, id)
    return c.json(await readTopic(user, id))
  }

  const names: string[] = []
  for (const raw of proposed) {
    const tag = await ensureTag(user, raw.name, raw.emoji)
    if (tag) names.push(tag)
  }
  return c.json(await writeTags(user, id, [...new Set(names)]))
})
