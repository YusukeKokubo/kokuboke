import { Hono } from 'hono'
import { NO_NAME, type OrganizeEvent, type SummaryEvent, type TagOrganizeAction } from '../../shared/types'
import { resolveModel, unfence } from '../agent'
import { parseOrganize } from '../agent/name'
import { organizePrompt, organizeSystemPrompt, tagDraftPrompt, tagDraftSystemPrompt, tagNote } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { BadRequestError } from '../errors'
import { streamAgent } from '../lib/agent-stream'
import { readJson, readText } from '../lib/body'
import { readAll } from '../store/log'
import { asTopicName, tagsDir } from '../store/paths'
import { appendRevision, readRevisions, splitOrganizeActions } from '../store/revision'
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
import { readClaude, readOrganize } from '../store/user'
import { resolveSpace, spacePaths, tagPaths } from './space'

function asOrganizeActions(raw: unknown): TagOrganizeAction[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is TagOrganizeAction => {
    if (!item || typeof item !== 'object') return false
    const action = item as TagOrganizeAction
    return action.type === 'merge' || action.type === 'shelf' || action.type === 'remove'
  })
}

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
      revisions: await readRevisions(user),
      policy: await readOrganize(user),
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
  const body = await readJson<{ actions?: unknown; proposed?: unknown }>(c.req.raw)
  if (!Array.isArray(body.actions)) {
    throw new BadRequestError('整理の指定が不正です')
  }
  const actions = asOrganizeActions(body.actions)
  const proposed = asOrganizeActions(body.proposed)
  const { accepted, rejected } = splitOrganizeActions(proposed, actions)
  const key = asTopicName('organize')
  if (!key) throw new BadRequestError('整理できませんでした')
  const release = await limiter.acquire(space.busyKey(key))
  try {
    if (rejected.length > 0) {
      await appendRevision(space.user, { kind: 'organize', accepted, rejected })
    }
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
  const current = await readTag(user, tag)
  const next = await renameTag(user, tag, { name: body.name, emoji: body.emoji, group: body.group })
  if (body.name !== undefined && current.name !== next.name) {
    await appendRevision(user, {
      kind: 'organize',
      accepted: [{ type: 'merge', from: current.name, to: next.name }],
      rejected: [],
    })
  }
  if (body.group !== undefined && current.group !== next.group && next.group) {
    await appendRevision(user, {
      kind: 'organize',
      accepted: [{ type: 'shelf', name: next.name, group: next.group }],
      rejected: [],
    })
  }
  return c.json(next)
})

tags.on('DELETE', tagPaths(), async (c) => {
  const { user } = resolveSpace(c)
  const name = assertTagName(c.req.param('tag') ?? '')
  await deleteTag(user, name)
  await appendRevision(user, {
    kind: 'organize',
    accepted: [{ type: 'remove', name }],
    rejected: [],
  })
  return c.body(null, 204)
})

tags.on('POST', tagPaths('/draft'), async (c) => {
  const space = resolveSpace(c)
  const { user } = space
  const name = assertTagName(c.req.param('tag') ?? '')
  const current = await readTag(user, name)

  // 日数では切らない。国際情勢のように一件ごとに話題が変わるタグでも、
  // 本人の求め方は古い会話にも出ている。新しい順に渡し、長すぎる分はプロンプト側が古い方から落とす。
  const tagged = (await listTopics(user)).filter((topic) => topic.tags.includes(name))
  const chats = []
  for (const topic of tagged) {
    const found = await resolveTopic(user, topic.slug)
    if (!found) continue
    chats.push({ name: topic.name || NO_NAME, history: await readAll(user, found.folder) })
  }
  if (chats.every((chat) => chat.history.length === 0)) {
    throw new BadRequestError('このタグの会話がまだないよ')
  }

  const newest = tagged[0]
  const choice = resolveModel(newest?.engine, newest?.model)
  const release = await limiter.acquire(space.busyKey(name))

  return streamAgent<SummaryEvent>(c, {
    choice,
    cwd: tagsDir(user),
    prompt: tagDraftPrompt({
      tagName: name,
      current: current.text,
      claude: await readClaude(user),
      profile: await space.profile(),
      chats,
    }),
    systemPrompt: tagDraftSystemPrompt({ audience: space.audience, tagName: name }),
    release,
    tag: 'tag-draft',
    fallback: '指示書を整理できませんでした',
    close: (text, send) => send({ type: 'done', text: unfence(text), modelLabel: choice.label }),
  })
})
