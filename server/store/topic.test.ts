import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const {
  createTopic,
  deleteTopic,
  listTopics,
  readTopic,
  renameTopic,
  shouldAutoName,
  shouldAutoTag,
  topicExists,
  writeTags,
} = await import('./topic')
const { appendMessage, readAll } = await import('./log')
const { asTopicName, assertTopicName, assertUser, imagesDir, logsDir, topicDir } =
  await import('./paths')
const { NotFoundError } = await import('../errors')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
})

function idOf(slug: string) {
  const id = asTopicName(slug)
  assert.ok(id)
  return id
}

describe('createTopic', () => {
  it('フォルダは untitled- の id で、見出しは json に置く', async () => {
    const topic = await createTopic(USER, { name: '買い物' })
    assert.match(topic.slug, /^untitled-\d{8}-\d{4}/)
    assert.equal(topic.name, '買い物')
    assert.deepEqual(topic.tags, [])

    const dir = topicDir(USER, idOf(topic.slug))
    assert.ok((await fsp.stat(dir)).isDirectory())
    const link = await fsp.readlink(path.join(dir, 'AGENTS.md'))
    assert.equal(link, path.join('..', '..', 'CLAUDE.md'))
  })

  it('名前なしでも作れる', async () => {
    const topic = await createTopic(USER, {})
    assert.equal(topic.name, '')
    assert.match(topic.slug, /^untitled-/)
  })
})

describe('renameTopic', () => {
  it('見出しだけ変えてフォルダは動かさない', async () => {
    const topic = await createTopic(USER, { name: '仮' })
    const id = idOf(topic.slug)
    const renamed = await renameTopic(USER, id, { name: '買い物メモ' })

    assert.equal(renamed.slug, topic.slug)
    assert.equal(renamed.name, '買い物メモ')
    assert.ok(await topicExists(USER, id))
  })
})

describe('writeTags', () => {
  it('配列を書き、tagTried が立つ', async () => {
    const topic = await createTopic(USER, {})
    const id = idOf(topic.slug)
    const next = await writeTags(USER, id, ['秋の旅行'])
    assert.deepEqual(next.tags, ['秋の旅行'])
    assert.equal(await shouldAutoTag(USER, id), false)
  })
})

describe('listTopics', () => {
  it('最後に話した順', async () => {
    const older = await createTopic(USER, { name: '古い' })
    const newer = await createTopic(USER, { name: '新しい' })
    await appendMessage(USER, idOf(older.slug), {
      id: '1',
      role: 'user',
      text: 'きのう',
      images: [],
      at: '2026-08-10T10:00:00.000Z',
    })
    await appendMessage(USER, idOf(newer.slug), {
      id: '2',
      role: 'user',
      text: 'きょう',
      images: [],
      at: '2026-08-11T10:00:00.000Z',
    })

    const list = await listTopics(USER)
    assert.deepEqual(
      list.map((t) => t.name),
      ['新しい', '古い'],
    )
  })
})

describe('deleteTopic', () => {
  it('実体が無ければ NotFoundError', async () => {
    await assert.rejects(() => deleteTopic(USER, assertTopicName('無い会話')), NotFoundError)
  })

  it('logs と images の中身まで消える', async () => {
    const topic = await createTopic(USER, { name: '消す' })
    const id = idOf(topic.slug)

    await appendMessage(USER, id, {
      id: '1',
      role: 'user',
      text: '消える発言',
      images: [],
      at: new Date().toISOString(),
    })
    await fsp.writeFile(path.join(imagesDir(USER, id), '20260813_120000_ab12.jpg'), 'dummy')

    await deleteTopic(USER, id)

    assert.equal(await topicExists(USER, id), false)
    await assert.rejects(() => fsp.readdir(logsDir(USER, id)), { code: 'ENOENT' })
    await assert.rejects(() => fsp.readdir(imagesDir(USER, id)), { code: 'ENOENT' })
  })

  it('消したあとに書かれても、前の会話は作り直した会話に出てこない', async () => {
    const topic = await createTopic(USER, { name: '子' })
    const id = idOf(topic.slug)

    await appendMessage(USER, id, {
      id: '1',
      role: 'assistant',
      text: '前のトピックの返事',
      images: [],
      at: new Date().toISOString(),
    })

    await deleteTopic(USER, id)
    await appendMessage(USER, id, {
      id: '2',
      role: 'user',
      text: 'すれ違って届いた発言',
      images: [],
      at: new Date().toISOString(),
    })
    const created = await createTopic(USER, { name: '子' })

    const texts = (await readAll(USER, idOf(created.slug))).map((m) => m.text)
    assert.ok(!texts.includes('前のトピックの返事'), `消した会話が残っている: ${texts.join(' / ')}`)
  })
})

describe('shouldAutoName / shouldAutoTag', () => {
  it('三往復するまで立たない', async () => {
    const topic = await createTopic(USER, {})
    const id = idOf(topic.slug)
    assert.equal(await shouldAutoName(USER, id), false)
    assert.equal(await shouldAutoTag(USER, id), false)

    for (let i = 0; i < 3; i++) {
      await appendMessage(USER, id, {
        id: String(i),
        role: 'user',
        text: `発言 ${i}`,
        images: [],
        at: new Date().toISOString(),
      })
    }

    assert.equal(await shouldAutoName(USER, id), true)
    assert.equal(await shouldAutoTag(USER, id), true)
  })

  it('名前が付いたら命名はもう走らない', async () => {
    const topic = await createTopic(USER, { name: '買い物' })
    const id = idOf(topic.slug)
    for (let i = 0; i < 3; i++) {
      await appendMessage(USER, id, {
        id: String(i),
        role: 'user',
        text: `発言 ${i}`,
        images: [],
        at: new Date().toISOString(),
      })
    }
    assert.equal(await shouldAutoName(USER, id), false)
    assert.equal(await shouldAutoTag(USER, id), true)
  })
})

describe('readTopic', () => {
  it('無い会話は NotFoundError', async () => {
    await assert.rejects(() => readTopic(USER, assertTopicName('無い')), NotFoundError)
  })
})
