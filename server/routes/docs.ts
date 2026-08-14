import { Hono } from 'hono'
import type { Claude, Profile } from '../../shared/types'
import { readText } from '../lib/body'
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
docs.get('/api/users/:user/profile', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json<Profile>({ profile: await readProfile(user) })
})

docs.put('/api/users/:user/profile', async (c) => {
  const user = assertUser(c.req.param('user'))
  await writeProfile(user, await readText(c.req.raw, 'profile'))
  return c.json<Profile>({ profile: await readProfile(user) })
})

docs.on('GET', spacePaths('/claude'), async (c) => {
  const { user } = resolveSpace(c)
  return c.json<Claude>({ claude: await readUserClaude(user) })
})

docs.on('PUT', spacePaths('/claude'), async (c) => {
  const { user } = resolveSpace(c)
  await writeUserClaude(user, await readText(c.req.raw, 'claude'))
  return c.json<Claude>({ claude: await readUserClaude(user) })
})

docs.on('GET', topicPaths('/claude'), async (c) => {
  const { space, ref } = await requireTopic(c)
  return c.json<Claude>({ claude: await readTopicClaude(space.user, ref) })
})

docs.on('PUT', topicPaths('/claude'), async (c) => {
  const { space, ref } = await requireTopic(c)
  await writeTopicClaude(space.user, ref, await readText(c.req.raw, 'claude'))
  return c.json<Claude>({ claude: await readTopicClaude(space.user, ref) })
})
