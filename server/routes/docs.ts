import { Hono } from 'hono'
import { markdownDoc } from '../lib/doc'
import { assertUser } from '../store/paths'
import {
  readClaude as readUserClaude,
  readProfile,
  writeClaude as writeUserClaude,
  writeProfile,
} from '../store/user'
import { resolveSpace, spacePaths } from './space'

export const docs = new Hono()

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
