import { Hono } from 'hono'
import type { Claude, Profile } from '../../shared/types'
import { readText } from '../lib/body'
import { assertUser } from '../store/paths'
import {
  readClaude as readTopicClaude,
  writeClaude as writeTopicClaude,
} from '../store/topic'
import {
  readClaude as readUserClaude,
  readProfile,
  writeClaude as writeUserClaude,
  writeProfile,
} from '../store/user'
import { requireTopic, topicPaths } from './target'

export const docs = new Hono()

docs.get('/api/users/:user/profile', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json<Profile>({ profile: await readProfile(user) })
})

docs.put('/api/users/:user/profile', async (c) => {
  const user = assertUser(c.req.param('user'))
  const profile = await readText(c.req.raw, 'profile')
  await writeProfile(user, profile)
  return c.json<Profile>({ profile: await readProfile(user) })
})

docs.get('/api/users/:user/claude', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json<Claude>({ claude: await readUserClaude(user) })
})

docs.put('/api/users/:user/claude', async (c) => {
  const user = assertUser(c.req.param('user'))
  const claude = await readText(c.req.raw, 'claude')
  await writeUserClaude(user, claude)
  return c.json<Claude>({ claude: await readUserClaude(user) })
})

docs.on('GET', topicPaths('/claude'), async (c) => {
  const { user, ref } = await requireTopic(c)
  return c.json<Claude>({ claude: await readTopicClaude(user, ref) })
})

docs.on('PUT', topicPaths('/claude'), async (c) => {
  const { user, ref } = await requireTopic(c)
  const claude = await readText(c.req.raw, 'claude')
  await writeTopicClaude(user, ref, claude)
  return c.json<Claude>({ claude: await readTopicClaude(user, ref) })
})
