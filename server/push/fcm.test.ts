import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-fcm-'))
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
// .env の FCM_SERVICE_ACCOUNT_PATH はインラインより優先されるので、先に空で潰す。
process.env.FCM_SERVICE_ACCOUNT_PATH = ''
process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'demo-proj',
  client_email: 'fcm@demo.iam.gserviceaccount.com',
  private_key: pem.replace(/\n/g, '\\n'),
})

const { parseServiceAccount, resetFcmCache, sendFcm, setRequest } = await import('./fcm')

after(() => {
  setRequest((...args) => globalThis.fetch(...args))
  resetFcmCache()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('parseServiceAccount', () => {
  it('壊れた JSON や欠けた欄は捨てる', () => {
    assert.equal(parseServiceAccount('{'), null)
    assert.equal(parseServiceAccount('{}'), null)
    assert.equal(parseServiceAccount(JSON.stringify({ project_id: 'p' })), null)
  })

  it('private_key の \\n を本物の改行に戻す', () => {
    const parsed = parseServiceAccount(
      JSON.stringify({
        project_id: 'p',
        client_email: 'a@b',
        private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
      }),
    )
    assert.ok(parsed)
    assert.equal(parsed.private_key.includes('\n'), true)
    assert.equal(parsed.private_key.includes('\\n'), false)
  })
})

describe('sendFcm', () => {
  it('トークンが無効なら gone', async () => {
    const calls: string[] = []
    setRequest(async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
        })
      }
      return new Response('UNREGISTERED', { status: 404 })
    })
    resetFcmCache()

    assert.equal(
      await sendFcm('device-token-value-that-is-long-enough', {
        title: '夕食の相談',
        body: '返答が届いたよ',
        path: '/user/taro/abc',
      }),
      'gone',
    )
    assert.ok(calls.some((url) => url.includes('oauth2.googleapis.com')))
    assert.ok(calls.some((url) => url.includes('demo-proj/messages:send')))
  })

  it('200 なら ok', async () => {
    setRequest(async (input) => {
      const url = String(input)
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
        })
      }
      return new Response('{}', { status: 200 })
    })
    resetFcmCache()

    assert.equal(
      await sendFcm('device-token-value-that-is-long-enough', {
        title: '夕食の相談',
        body: '返答が届いたよ',
        path: '/family/abc',
      }),
      'ok',
    )
  })
})
