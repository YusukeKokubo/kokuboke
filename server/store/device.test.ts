import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-dev-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro,hanako'

const { addDevice, assertDeviceToken, listDeviceTokens, removeDevice, removeDevices } =
  await import('./device')
const { assertUser, devicesFile } = await import('./paths')
const { ensureUser } = await import('./user')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const TARO = assertUser('taro')
const HANAKO = assertUser('hanako')
const TOKEN_A = `a${'x'.repeat(140)}`
const TOKEN_B = `b${'y'.repeat(140)}`

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
  await fsp.rm(path.join(dataDir, 'hanako'), { recursive: true, force: true })
  await ensureUser(TARO)
  await ensureUser(HANAKO)
})

describe('assertDeviceToken', () => {
  it('短すぎるものや空白だけのものは弾く', () => {
    assert.throws(() => assertDeviceToken('short'), /不正/)
    assert.throws(() => assertDeviceToken('   '), /不正/)
    assert.throws(() => assertDeviceToken(1), /不正/)
  })

  it('印字可能な ASCII だけ通す', () => {
    assert.equal(assertDeviceToken(`  ${TOKEN_A}  `), TOKEN_A)
    assert.throws(() => assertDeviceToken(`${TOKEN_A.slice(0, 20)}\n${TOKEN_A.slice(20)}`), /不正/)
  })
})

describe('addDevice / listDeviceTokens', () => {
  it('無いファイルは空', async () => {
    assert.deepEqual(await listDeviceTokens(TARO), [])
  })

  it('付けたトークンが devices.json に残る', async () => {
    await addDevice(TARO, TOKEN_A)
    assert.deepEqual(await listDeviceTokens(TARO), [TOKEN_A])
    const doc = JSON.parse(await fsp.readFile(devicesFile(TARO), 'utf8')) as {
      tokens: Array<{ token: string; at: string }>
    }
    assert.equal(doc.tokens[0]?.token, TOKEN_A)
    assert.ok(doc.tokens[0]?.at)
  })

  it('同じトークンは重ねず時刻だけ更新する', async () => {
    await addDevice(TARO, TOKEN_A)
    const first = JSON.parse(await fsp.readFile(devicesFile(TARO), 'utf8')) as DevicesFile
    await addDevice(TARO, TOKEN_A)
    const second = JSON.parse(await fsp.readFile(devicesFile(TARO), 'utf8')) as DevicesFile
    assert.equal(second.tokens.length, 1)
    assert.ok(second.tokens[0]!.at >= first.tokens[0]!.at)
  })

  it('二台目は並べて持つ', async () => {
    await addDevice(TARO, TOKEN_A)
    await addDevice(TARO, TOKEN_B)
    assert.deepEqual(await listDeviceTokens(TARO), [TOKEN_A, TOKEN_B])
  })

  it('同じトークンを別の人に付けると、前の人からは外れる', async () => {
    await addDevice(TARO, TOKEN_A)
    await addDevice(HANAKO, TOKEN_A)
    assert.deepEqual(await listDeviceTokens(TARO), [])
    assert.deepEqual(await listDeviceTokens(HANAKO), [TOKEN_A])
  })
})

describe('removeDevice / removeDevices', () => {
  it('無いトークンを外してもファイルは触らない', async () => {
    await removeDevice(TARO, TOKEN_A)
    await assert.rejects(() => fsp.stat(devicesFile(TARO)), { code: 'ENOENT' })
  })

  it('付けたトークンを外せる', async () => {
    await addDevice(TARO, TOKEN_A)
    await addDevice(TARO, TOKEN_B)
    await removeDevice(TARO, TOKEN_A)
    assert.deepEqual(await listDeviceTokens(TARO), [TOKEN_B])
  })

  it('まとめて外せる', async () => {
    await addDevice(TARO, TOKEN_A)
    await addDevice(TARO, TOKEN_B)
    await removeDevices(TARO, [TOKEN_A, TOKEN_B])
    assert.deepEqual(await listDeviceTokens(TARO), [])
  })
})

type DevicesFile = { tokens: Array<{ token: string; at: string }> }
