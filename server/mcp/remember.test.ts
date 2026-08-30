import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-mcp-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
process.env.TZ = 'Asia/Tokyo'

const { ensureUser } = await import('../store/user')
const { assertUser, topicDir } = await import('../store/paths')
const { createTopic, resolveTopic } = await import('../store/topic')
const { personalRememberUser, remember } = await import('./remember')
const { handleMessage } = await import('./rpc')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

async function topicCwd(): Promise<string> {
  const topic = await createTopic(USER, {})
  const found = await resolveTopic(USER, topic.slug)
  assert.ok(found)
  return topicDir(USER, found.folder)
}

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
  await ensureUser(USER)
  delete process.env.KOKUBOKE_REMEMBER_USER
})

describe('personalRememberUser', () => {
  it('個人の topics 配下かつ env がその人なら通る', async () => {
    const cwd = await topicCwd()
    assert.equal(personalRememberUser(cwd, 'taro'), 'taro')
  })

  it('env が無い・家族・tags は通さない', async () => {
    const cwd = await topicCwd()
    assert.equal(personalRememberUser(cwd, undefined), null)
    assert.equal(personalRememberUser(cwd, '  '), null)
    assert.equal(personalRememberUser(cwd, '_family'), null)
    const tags = path.join(dataDir, 'taro', 'tags')
    assert.equal(personalRememberUser(tags, 'taro'), null)
    const familyTopic = path.join(dataDir, '_family', 'topics', 'x')
    assert.equal(personalRememberUser(familyTopic, 'taro'), null)
  })
})

describe('remember', () => {
  it('個人の会話なら追記する', async () => {
    const cwd = await topicCwd()
    process.env.KOKUBOKE_REMEMBER_USER = 'taro'
    const result = await remember('猫が好き', cwd)
    assert.equal(result.ok, true)
    const file = path.join(dataDir, 'taro', '覚え書き.md')
    assert.match(await fsp.readFile(file, 'utf8'), /猫が好き/)
  })

  it('文脈が取れなければ断る', async () => {
    process.env.KOKUBOKE_REMEMBER_USER = 'taro'
    const result = await remember('書かない', dataDir)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('ok')
    assert.match(result.reason, /書けません/)
  })
})

describe('handleMessage', () => {
  it('tools/list に remember だけ出す', async () => {
    const reply = await handleMessage({ method: 'tools/list', id: 1 })
    assert.ok(reply)
    const tools = (reply.result as { tools: Array<{ name: string }> }).tools
    assert.deepEqual(
      tools.map((t) => t.name),
      ['remember'],
    )
  })

  it('個人の会話なら覚えたと返す', async () => {
    const cwd = await topicCwd()
    process.env.KOKUBOKE_REMEMBER_USER = 'taro'
    const reply = await handleMessage(
      {
        method: 'tools/call',
        id: 2,
        params: { name: 'remember', arguments: { text: '紅茶が好き' } },
      },
      cwd,
    )
    assert.ok(reply)
    const content = (reply.result as { content: Array<{ text: string }>; isError?: boolean }).content
    assert.equal(content[0]?.text, '覚えた')
  })
})
