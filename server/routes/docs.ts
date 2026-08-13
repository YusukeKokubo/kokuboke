import { Hono } from 'hono'
import type { Claude, Profile } from '../../shared/types'
import { BadRequestError } from '../errors'
import { readJson } from '../lib/body'
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
  const body = await readJson<{ profile?: string }>(c.req.raw)
  if (typeof body.profile !== 'string') {
    throw new BadRequestError('保存する内容がありません')
  }

  await writeProfile(user, body.profile)
  return c.json<Profile>({ profile: await readProfile(user) })
})

docs.get('/api/users/:user/claude', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json<Claude>({ claude: await readUserClaude(user) })
})

docs.put('/api/users/:user/claude', async (c) => {
  const user = assertUser(c.req.param('user'))
  const body = await readJson<{ claude?: string }>(c.req.raw)
  if (typeof body.claude !== 'string') {
    throw new BadRequestError('保存する内容がありません')
  }

  await writeUserClaude(user, body.claude)
  return c.json<Claude>({ claude: await readUserClaude(user) })
})

docs.on('GET', topicPaths('/claude'), async (c) => {
  const { user, ref } = await requireTopic(c)
  return c.json<Claude>({ claude: await readTopicClaude(user, ref) })
})

docs.on('PUT', topicPaths('/claude'), async (c) => {
  const { user, ref } = await requireTopic(c)
  const body = await readJson<{ claude?: string }>(c.req.raw)
  if (typeof body.claude !== 'string') {
    throw new BadRequestError('保存する内容がありません')
  }

  await writeTopicClaude(user, ref, body.claude)
  return c.json<Claude>({ claude: await readTopicClaude(user, ref) })
})
