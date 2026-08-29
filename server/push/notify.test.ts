import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-notify-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
process.env.FCM_SERVICE_ACCOUNT = ''
process.env.FCM_SERVICE_ACCOUNT_PATH = ''

const { addDevice, listDeviceTokens } = await import('../store/device')
const { assertUser } = await import('../store/paths')
const { ensureUser } = await import('../store/user')
const { resetFcmCache, setRequest } = await import('./fcm')
const { notifyReply } = await import('./notify')

after(() => {
  setRequest((...args) => globalThis.fetch(...args))
  resetFcmCache()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const USER = assertUser('taro')
const TOKEN = `n${'z'.repeat(140)}`

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
  await ensureUser(USER)
  resetFcmCache()
})

describe('notifyReply', () => {
  it('設定が無ければ端末はそのまま', async () => {
    let called = 0
    setRequest(async () => {
      called += 1
      return new Response('no', { status: 500 })
    })
    await addDevice(USER, TOKEN)
    await notifyReply({
      recipient: USER,
      topicName: '夕食の相談',
      path: '/user/taro/abc',
    })
    assert.equal(called, 0)
    assert.deepEqual(await listDeviceTokens(USER), [TOKEN])
  })

  it('トークンが無ければ送らない', async () => {
    let called = 0
    setRequest(async () => {
      called += 1
      return new Response('no', { status: 500 })
    })
    await notifyReply({
      recipient: USER,
      topicName: '夕食の相談',
      path: '/user/taro/abc',
    })
    assert.equal(called, 0)
  })
})
