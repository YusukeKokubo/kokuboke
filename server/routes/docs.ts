import { Hono } from 'hono'
import { markdownDoc } from '../lib/doc'
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
