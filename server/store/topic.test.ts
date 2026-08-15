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
  markNameTried,
  readTopic,
  renameTopic,
  resolveTopic,
  shouldAutoName,
  shouldAutoTag,
  topicExists,
  writeTags,
} = await import('./topic')
const { appendMessage, readAll } = await import('./log')
const { assertTopicName, assertUser, imagesDir, logsDir, topicDir } = await import('./paths')
const { NotFoundError } = await import('../errors')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function folderOf(slug: string) {
  const found = await resolveTopic(USER, slug)
  assert.ok(found)
  return found.folder
}

describe('createTopic', () => {
  it('URL は uuid、フォルダは日付と見出し', async () => {
    const topic = await createTopic(USER, { name: '買い物' })
    assert.match(topic.slug, UUID)
    assert.equal(topic.name, '買い物')
    assert.deepEqual(topic.tags, [])

    const folder = await folderOf(topic.slug)
    assert.match(folder, /^\d{2}-\d{2}-\d{2}-買い物$/)
    const dir = topicDir(USER, folder)
    assert.ok((await fsp.stat(dir)).isDirectory())
    const link = await fsp.readlink(path.join(dir, 'AGENTS.md'))
    assert.equal(link, path.join('..', '..', 'CLAUDE.md'))
  })

  it('名前なしでも作れる', async () => {
    const topic = await createTopic(USER, {})
    assert.equal(topic.name, '')
    assert.match(topic.slug, UUID)
    assert.match(await folderOf(topic.slug), /^\d{2}-\d{2}-\d{2}$/)
  })
})

describe('renameTopic', () => {
  it('URL は残して、フォルダ名を見出しに合わせる', async () => {
    const topic = await createTopic(USER, { name: '仮' })
    const before = await folderOf(topic.slug)
    const renamed = await renameTopic(USER, before, { name: '買い物メモ' })

    assert.equal(renamed.slug, topic.slug)
    assert.equal(renamed.name, '買い物メモ')
    assert.equal(await topicExists(USER, before), false)
    assert.match(await folderOf(renamed.slug), /^\d{2}-\d{2}-\d{2}-買い物メモ$/)
  })
})

describe('writeTags', () => {
  it('配列を書き、tagTried が立つ', async () => {
    const topic = await createTopic(USER, {})
    const id = await folderOf(topic.slug)
    const next = await writeTags(USER, id, ['秋の旅行'])
    assert.deepEqual(next.tags, ['秋の旅行'])
    assert.equal(await shouldAutoTag(USER, id), false)
  })
})

describe('listTopics', () => {
  it('最後に話した順', async () => {
    const older = await createTopic(USER, { name: '古い' })
    const newer = await createTopic(USER, { name: '新しい' })
    await appendMessage(USER, await folderOf(older.slug), {
      id: '1',
      role: 'user',
      text: 'きのう',
      images: [],
      at: '2026-08-10T10:00:00.000Z',
    })
    await appendMessage(USER, await folderOf(newer.slug), {
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
    const id = await folderOf(topic.slug)

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
    const id = await folderOf(topic.slug)

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

    const texts = (await readAll(USER, await folderOf(created.slug))).map((m) => m.text)
    assert.ok(!texts.includes('前のトピックの返事'), `消した会話が残っている: ${texts.join(' / ')}`)
  })
})

async function addUser(slug: string, text: string) {
  await appendMessage(USER, await folderOf(slug), {
    id: text,
    role: 'user',
    text,
    images: [],
    at: new Date().toISOString(),
  })
}

describe('shouldAutoName / shouldAutoTag', () => {
  it('1, 3, 5 回目に命名が立つ', async () => {
    const topic = await createTopic(USER, {})
    const id = topic.slug
    assert.equal(await shouldAutoName(USER, id), false)
    assert.equal(await shouldAutoTag(USER, id), false)

    await addUser(id, '1')
    assert.equal(await shouldAutoName(USER, id), true)
    assert.equal(await shouldAutoTag(USER, id), false)

    await renameTopic(USER, id, { name: '仮', autoAt: 1 })
    assert.equal(await shouldAutoName(USER, id), false)

    await addUser(id, '2')
    assert.equal(await shouldAutoName(USER, id), false)
    assert.equal(await shouldAutoTag(USER, id), false)

    await addUser(id, '3')
    assert.equal(await shouldAutoName(USER, id), true)
    assert.equal(await shouldAutoTag(USER, id), true)

    await renameTopic(USER, id, { name: '付け直し', autoAt: 3 })
    assert.equal(await shouldAutoName(USER, id), false)

    await addUser(id, '4')
    assert.equal(await shouldAutoName(USER, id), false)

    await addUser(id, '5')
    assert.equal(await shouldAutoName(USER, id), true)

    await renameTopic(USER, id, { name: '確定', autoAt: 5 })
    assert.equal(await shouldAutoName(USER, id), false)

    await addUser(id, '6')
    assert.equal(await shouldAutoName(USER, id), false)
  })

  it('人が付けた名前は自動では付け直さない', async () => {
    const topic = await createTopic(USER, { name: '買い物' })
    const id = topic.slug
    for (let i = 0; i < 5; i++) {
      await addUser(id, `発言 ${i}`)
    }
    assert.equal(await shouldAutoName(USER, id), false)
    assert.equal(await shouldAutoTag(USER, id), true)
  })

  it('途中で人が付け直したら、あとの自動命名は走らない', async () => {
    const topic = await createTopic(USER, {})
    const id = topic.slug
    await addUser(id, '1')
    await renameTopic(USER, id, { name: '仮', autoAt: 1 })
    await renameTopic(USER, id, { name: '自分で付けた' })
    await addUser(id, '2')
    await addUser(id, '3')
    assert.equal(await shouldAutoName(USER, id), false)
  })

  it('1 回目の自動命名に失敗しても 3 回目は再挑戦する', async () => {
    const topic = await createTopic(USER, {})
    const id = topic.slug
    await addUser(id, '1')
    await markNameTried(USER, id)
    assert.equal(await shouldAutoName(USER, id), false)
    await addUser(id, '2')
    await addUser(id, '3')
    assert.equal(await shouldAutoName(USER, id), true)
  })
})

describe('readTopic', () => {
  it('無い会話は NotFoundError', async () => {
    await assert.rejects(() => readTopic(USER, assertTopicName('無い')), NotFoundError)
  })
})
