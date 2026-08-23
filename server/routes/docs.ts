import { Hono } from 'hono'
import type { SummaryEvent } from '../../shared/types'
import { resolveModel, unfence } from '../agent'
import { organizeDraftPrompt, organizeDraftSystemPrompt, tagNote } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { BadRequestError } from '../errors'
import { streamAgent } from '../lib/agent-stream'
import { markdownDoc } from '../lib/doc'
import { asTopicName, userDir } from '../store/paths'
import { readRevisions } from '../store/revision'
import { listTags } from '../store/tag'
import { listTopics } from '../store/topic'
import {
  readClaude as readUserClaude,
  readOrganize,
  readProfile,
  writeClaude as writeUserClaude,
  writeOrganize,
  writeProfile,
} from '../store/user'
import { resolveSpace, spacePaths } from './space'

export const docs = new Hono()

markdownDoc(
  docs,
  spacePaths('/profile'),
  'profile',
  (c) => readProfile(resolveSpace(c).user),
  (c, text) => writeProfile(resolveSpace(c).user, text),
)

markdownDoc(
  docs,
  spacePaths('/claude'),
  'claude',
  (c) => readUserClaude(resolveSpace(c).user),
  (c, text) => writeUserClaude(resolveSpace(c).user, text),
)

markdownDoc(
  docs,
  spacePaths('/organize'),
  'organize',
  (c) => readOrganize(resolveSpace(c).user),
  (c, text) => writeOrganize(resolveSpace(c).user, text),
)

docs.on('POST', spacePaths('/organize/draft'), async (c) => {
  const space = resolveSpace(c)
  const { user } = space
  const tags = await listTags(user)
  const topics = await listTopics(user)
  const choice = resolveModel(topics[0]?.engine, topics[0]?.model)
  const key = asTopicName('organize')
  if (!key) throw new BadRequestError('方針をまとめられませんでした')
  const release = await limiter.acquire(space.busyKey(key))

  return streamAgent<SummaryEvent>(c, {
    choice,
    cwd: userDir(user),
    prompt: organizeDraftPrompt({
      current: await readOrganize(user),
      revisions: await readRevisions(user),
      tags: tags.map((tag) => ({
        name: tag.name,
        group: tag.group,
        note: tagNote(tag.text),
      })),
    }),
    systemPrompt: organizeDraftSystemPrompt(),
    release,
    tag: 'organize-draft',
    fallback: '方針をまとめられませんでした',
    close: (text, send) => send({ type: 'done', text: unfence(text), modelLabel: choice.label }),
  })
})
