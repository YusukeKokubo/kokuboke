import { Hono } from 'hono'
import { NO_NAME, type OrganizeEvent, type SummaryEvent, type TagOrganizeAction } from '../../shared/types'
import { resolveModel, unfence } from '../agent'
import { parseOrganize } from '../agent/name'
import { organizePrompt, organizeSystemPrompt, tagDraftPrompt, tagDraftSystemPrompt, tagNote } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { streamAgent } from '../lib/agent-stream'
import { readJson, readText } from '../lib/body'
import { readRecent } from '../store/log'
import { asTopicName, tagsDir } from '../store/paths'
import {
  applyOrganize,
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
  const body = await readJson<{ name?: string; text?: string; emoji?: string; group?: string }>(
    c.req.raw,
  )
  if (typeof body.name !== 'string') {
    throw new BadRequestError('タグ名を入力してください')
  }
  return c.json(
    await createTag(user, {
      name: body.name,
      text: body.text,
      emoji: body.emoji,
      group: body.group,
    }),
    201,
  )
})

tags.on('POST', spacePaths('/tags/organize'), async (c) => {
  const space = resolveSpace(c)
  const { user } = space
  const tags = await listTags(user)
  if (tags.length === 0) {
    throw new BadRequestError('まだタグがないよ')
  }

  const topics = await listTopics(user)
  const choice = resolveModel(topics[0]?.engine, topics[0]?.model)
  const key = asTopicName('organize')
  if (!key) throw new BadRequestError('整理できませんでした')
  const release = await limiter.acquire(space.busyKey(key))

  return streamAgent<OrganizeEvent>(c, {
    choice,
    cwd: tagsDir(user),
    prompt: organizePrompt({
      tags: tags.map((tag) => ({
        name: tag.name,
        group: tag.group,
        note: tagNote(tag.text),
        topics: topics.filter((topic) => topic.tags.includes(tag.name)).map((topic) => topic.name || NO_NAME),
      })),
    }),
    systemPrompt: organizeSystemPrompt(),
    release,
    tag: 'tag-organize',
    fallback: '整理案を作れませんでした',
    close: (text, send) =>
      send({ type: 'done', actions: parseOrganize(unfence(text)), modelLabel: choice.label }),
  })
})

tags.on('POST', spacePaths('/tags/organize/apply'), async (c) => {
  const space = resolveSpace(c)
  const body = await readJson<{ actions?: unknown }>(c.req.raw)
  if (!Array.isArray(body.actions)) {
    throw new BadRequestError('整理の指定が不正です')
  }
  const actions = body.actions.filter((item): item is TagOrganizeAction => {
    if (!item || typeof item !== 'object') return false
    const action = item as TagOrganizeAction
    return action.type === 'merge' || action.type === 'shelf' || action.type === 'remove'
  })
  const key = asTopicName('organize')
  if (!key) throw new BadRequestError('整理できませんでした')
  const release = await limiter.acquire(space.busyKey(key))
  try {
    return c.json(await applyOrganize(space.user, actions))
  } finally {
    release()
  }
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
  const body = await readJson<{ name?: string; emoji?: string; group?: string }>(c.req.raw)
  if (body.name === undefined && body.emoji === undefined && body.group === undefined) {
    throw new BadRequestError('タグ名を入力してください')
  }
  return c.json(
    await renameTag(user, tag, { name: body.name, emoji: body.emoji, group: body.group }),
  )
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
