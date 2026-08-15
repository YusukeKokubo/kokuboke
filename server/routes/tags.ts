import { Hono } from 'hono'
import { NO_NAME, type SummaryEvent } from '../../shared/types'
import { resolveModel, unfence } from '../agent'
import { tagDraftPrompt, tagDraftSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { streamAgent } from '../lib/agent-stream'
import { readJson, readText } from '../lib/body'
import { readRecent } from '../store/log'
import { tagsDir } from '../store/paths'
import {
  assertTagName,
  createTag,
  deleteTag,
  listTags,
  readTag,
  renameTag,
  writeTag,
} from '../store/tag'
import { listTopics, resolveTopic } from '../store/topic'
import { resolveSpace, spacePaths, tagPaths } from './space'

export const tags = new Hono()

tags.on('GET', spacePaths('/tags'), async (c) => {
  return c.json(await listTags(resolveSpace(c).user))
})

tags.on('POST', spacePaths('/tags'), async (c) => {
  const { user } = resolveSpace(c)
  const body = await readJson<{ name?: string; text?: string; emoji?: string }>(c.req.raw)
  if (typeof body.name !== 'string') {
    throw new BadRequestError('タグ名を入力してください')
  }
  return c.json(await createTag(user, { name: body.name, text: body.text, emoji: body.emoji }), 201)
})

tags.on('GET', tagPaths(), async (c) => {
  const { user } = resolveSpace(c)
  return c.json(await readTag(user, assertTagName(c.req.param('tag') ?? '')))
})

tags.on('PUT', tagPaths(), async (c) => {
  const { user } = resolveSpace(c)
  const tag = assertTagName(c.req.param('tag') ?? '')
  return c.json(await writeTag(user, tag, await readText(c.req.raw, 'text')))
})

tags.on('PATCH', tagPaths(), async (c) => {
  const { user } = resolveSpace(c)
  const tag = assertTagName(c.req.param('tag') ?? '')
  const body = await readJson<{ name?: string; emoji?: string }>(c.req.raw)
  if (body.name === undefined && body.emoji === undefined) {
    throw new BadRequestError('タグ名を入力してください')
  }
  return c.json(await renameTag(user, tag, { name: body.name, emoji: body.emoji }))
})

tags.on('DELETE', tagPaths(), async (c) => {
  const { user } = resolveSpace(c)
  await deleteTag(user, assertTagName(c.req.param('tag') ?? ''))
  return c.body(null, 204)
})

tags.on('POST', tagPaths('/draft'), async (c) => {
  const space = resolveSpace(c)
  const { user } = space
  const name = assertTagName(c.req.param('tag') ?? '')
  const current = await readTag(user, name)
  const days = Math.max(config.contextDays, 14)

  const chats = []
  for (const topic of await listTopics(user)) {
    if (!topic.tags.includes(name)) continue
    const found = await resolveTopic(user, topic.slug)
    if (!found) continue
    chats.push({
      name: topic.name || NO_NAME,
      history: await readRecent(user, found.folder, days),
    })
  }
  if (chats.every((chat) => chat.history.length === 0)) {
    throw new BadRequestError('このタグの会話がまだないよ')
  }

  const newest = (await listTopics(user)).find((topic) => topic.tags.includes(name))
  const choice = resolveModel(newest?.engine, newest?.model)
  const release = await limiter.acquire(space.busyKey(name))

  return streamAgent<SummaryEvent>(c, {
    choice,
    cwd: tagsDir(user),
    prompt: tagDraftPrompt({ tagName: name, current: current.text, chats }),
    systemPrompt: tagDraftSystemPrompt({ audience: space.audience, tagName: name }),
    release,
    tag: 'tag-draft',
    fallback: '覚え書きを整理できませんでした',
    close: (text, send) => send({ type: 'done', text: unfence(text), modelLabel: choice.label }),
  })
})
