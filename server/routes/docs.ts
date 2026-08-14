import { Hono } from 'hono'
import { markdownDoc } from '../lib/doc'
import { assertUser } from '../store/paths'
import { readClaude as readTopicClaude, writeClaude as writeTopicClaude } from '../store/topic'
import {
  readClaude as readUserClaude,
  readProfile,
  writeClaude as writeUserClaude,
  writeProfile,
} from '../store/user'
import { requireTopic, resolveSpace, spacePaths, topicPaths } from './space'

export const docs = new Hono()

// profile.md は本人の人物像なので個人のスペースだけ。共有スペースには置かない。
markdownDoc(
  docs,
  '/api/users/:user/profile',
  'profile',
  (c) => readProfile(assertUser(c.req.param('user') ?? '')),
  (c, text) => writeProfile(assertUser(c.req.param('user') ?? ''), text),
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
  topicPaths('/claude'),
  'claude',
  async (c) => {
    const { space, ref } = await requireTopic(c)
    return readTopicClaude(space.user, ref)
  },
  async (c, text) => {
    const { space, ref } = await requireTopic(c)
    await writeTopicClaude(space.user, ref, text)
  },
)
