import fs from 'node:fs/promises'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { assertUser, devicesFile, type UserName } from './paths'
import { ensureUser } from './user'

export interface Device {
  token: string
  at: string
}

interface DevicesDoc {
  tokens: Device[]
}

/** FCM の登録トークン。長さ以外はサーバーでは中身を見ない。 */
export function assertDeviceToken(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new BadRequestError('端末の登録が不正です')
  }
  const token = raw.trim()
  if (token.length < 32 || token.length > 4096) {
    throw new BadRequestError('端末の登録が不正です')
  }
  if (!/^[\x21-\x7e]+$/.test(token)) {
    throw new BadRequestError('端末の登録が不正です')
  }
  return token
}

async function readDoc(user: UserName): Promise<DevicesDoc> {
  try {
    const parsed = JSON.parse(await fs.readFile(devicesFile(user), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { tokens: [] }
    const raw = (parsed as { tokens?: unknown }).tokens
    if (!Array.isArray(raw)) return { tokens: [] }
    const tokens: Device[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const row = item as { token?: unknown; at?: unknown }
      if (typeof row.token !== 'string' || !row.token) continue
      tokens.push({
        token: row.token,
        at: typeof row.at === 'string' ? row.at : new Date(0).toISOString(),
      })
    }
    return { tokens }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { tokens: [] }
    throw error
  }
}

async function writeDoc(user: UserName, doc: DevicesDoc): Promise<void> {
  await ensureUser(user)
  await fs.writeFile(devicesFile(user), JSON.stringify(doc, null, 2) + '\n')
}

export async function listDeviceTokens(user: UserName): Promise<string[]> {
  return (await readDoc(user)).tokens.map((item) => item.token)
}

/**
 * トークンをその人に付ける。同じ端末を別の人が使っていたら、そちらからは外す。
 * 家族のタブレットを貸し借りしたときに、前の人へも飛ぶのを避ける。
 */
export async function addDevice(user: UserName, token: string): Promise<void> {
  for (const name of config.users) {
    if (name === user) continue
    await removeDevice(assertUser(name), token)
  }

  const doc = await readDoc(user)
  const at = new Date().toISOString()
  const found = doc.tokens.find((item) => item.token === token)
  if (found) {
    found.at = at
  } else {
    doc.tokens.push({ token, at })
  }
  await writeDoc(user, doc)
}

export async function removeDevice(user: UserName, token: string): Promise<void> {
  const doc = await readDoc(user)
  const next = doc.tokens.filter((item) => item.token !== token)
  if (next.length === doc.tokens.length) return
  await writeDoc(user, { tokens: next })
}

export async function removeDevices(user: UserName, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  const drop = new Set(tokens)
  const doc = await readDoc(user)
  const next = doc.tokens.filter((item) => !drop.has(item.token))
  if (next.length === doc.tokens.length) return
  await writeDoc(user, { tokens: next })
}
