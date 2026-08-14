import { Hono } from 'hono'
import type { Claude } from '../../shared/types'
import { readText } from '../lib/body'
import { familyUser } from '../store/paths'
import {
  readClaude as readTopicClaude,
  writeClaude as writeTopicClaude,
} from '../store/topic'
import { readClaude as readFamilyClaude, writeClaude as writeFamilyClaude } from '../store/user'
import { familyTopicPaths, requireFamilyTopic } from './family-target'

export const familyDocs = new Hono()

familyDocs.get('/api/family/claude', async (c) => {
  const user = familyUser()
  return c.json<Claude>({ claude: await readFamilyClaude(user) })
})

familyDocs.put('/api/family/claude', async (c) => {
  const user = familyUser()
  const claude = await readText(c.req.raw, 'claude')
  await writeFamilyClaude(user, claude)
  return c.json<Claude>({ claude: await readFamilyClaude(user) })
})

familyDocs.on('GET', familyTopicPaths('/claude'), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)
  return c.json<Claude>({ claude: await readTopicClaude(user, ref) })
})

familyDocs.on('PUT', familyTopicPaths('/claude'), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)
  const claude = await readText(c.req.raw, 'claude')
  await writeTopicClaude(user, ref, claude)
  return c.json<Claude>({ claude: await readTopicClaude(user, ref) })
})
