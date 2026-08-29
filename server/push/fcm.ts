import { createSign } from 'node:crypto'
import fs from 'node:fs'
import { config } from '../config'

export interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

export interface PushPayload {
  title: string
  body: string
  path: string
}

interface TokenCache {
  value: string
  exp: number
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CHANNEL = 'kokuboke'

let cachedAccount: ServiceAccount | null | undefined
let cachedToken: TokenCache | null = null

/** テストから fetch を差し替える口。本番は globalThis.fetch。 */
export let request: typeof fetch = (...args) => globalThis.fetch(...args)

export function setRequest(fn: typeof fetch): void {
  request = fn
}

export function resetFcmCache(): void {
  cachedAccount = undefined
  cachedToken = null
}

export function parseServiceAccount(raw: string): ServiceAccount | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const doc = parsed as { project_id?: unknown; client_email?: unknown; private_key?: unknown }
  if (typeof doc.project_id !== 'string' || !doc.project_id) return null
  if (typeof doc.client_email !== 'string' || !doc.client_email) return null
  if (typeof doc.private_key !== 'string' || !doc.private_key) return null
  return {
    project_id: doc.project_id,
    client_email: doc.client_email,
    private_key: doc.private_key.replace(/\\n/g, '\n'),
  }
}

export function loadServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount
  cachedAccount = readAccount()
  return cachedAccount
}

function readAccount(): ServiceAccount | null {
  if (config.fcmServiceAccountPath) {
    try {
      return parseServiceAccount(fs.readFileSync(config.fcmServiceAccountPath, 'utf8'))
    } catch (error) {
      console.warn('[push] FCM_SERVICE_ACCOUNT_PATH が読めません', error)
      return null
    }
  }
  if (config.fcmServiceAccount) return parseServiceAccount(config.fcmServiceAccount)
  return null
}

function jwt(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claim = Buffer.from(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url')
  const unsigned = `${header}.${claim}`
  const sign = createSign('RSA-SHA256')
  sign.update(unsigned)
  return `${unsigned}.${sign.sign(account.private_key, 'base64url')}`
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value

  const res = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt(account),
    }),
  })
  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown }
  if (!res.ok || typeof body.access_token !== 'string') {
    throw new Error(`FCM の認証に失敗しました (${res.status})`)
  }
  const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600
  cachedToken = { value: body.access_token, exp: now + ttl }
  return cachedToken.value
}

/**
 * 1 端末へ送る。トークンが無効なら 'gone'。設定が無ければ送らない。
 */
export async function sendFcm(
  token: string,
  payload: PushPayload,
): Promise<'ok' | 'gone' | 'skip'> {
  const account = loadServiceAccount()
  if (!account) return 'skip'

  const bearer = await accessToken(account)
  const res = await request(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: {
            path: payload.path,
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: CHANNEL,
            },
          },
        },
      }),
    },
  )

  if (res.ok) return 'ok'
  if (res.status === 404 || res.status === 410) return 'gone'

  const text = await res.text().catch(() => '')
  if (res.status === 400 && /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(text)) {
    return 'gone'
  }
  throw new Error(`FCM が ${res.status} を返しました${text ? `: ${text.slice(0, 200)}` : ''}`)
}
