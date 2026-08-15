import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-migrate-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
process.env.TZ = 'Asia/Tokyo'

const { migrateNestedTopics, migrateTopicIds } = await import('./migrate')
const { assertUser, tagFile, topicDir, topicsDir } = await import('./paths')
const { readTopic, resolveTopic, topicExists } = await import('./topic')
const { ensureUser } = await import('./user')
const { asTopicName, assertTopicName } = await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
  await ensureUser(USER)
})

async function writeJson(file: string, value: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify(value, null, 2) + '\n')
}

describe('migrateNestedTopics', () => {
  it('器と子を id フォルダと tags/{器名}.md に移す', async () => {
    const group = path.join(topicsDir(USER), '2026秋の旅行')
    const childId = 'untitled-20260814-0938'
    const child = path.join(group, childId)
    await writeJson(path.join(group, 'topic.json'), {
      slug: '2026秋の旅行',
      name: '秋の旅行',
      emoji: '🍂',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await fsp.writeFile(path.join(group, 'summary.md'), '京都に行く\n')
    await writeJson(path.join(child, 'topic.json'), {
      slug: childId,
      name: '宿の予約',
      emoji: '🏨',
      createdAt: '2026-08-14T00:00:00.000Z',
    })
    await fsp.writeFile(path.join(child, 'CLAUDE.md'), '会話の役割')
    await fsp.writeFile(path.join(child, 'summary.md'), '会話の要約')
    await fsp.mkdir(path.join(child, 'logs'), { recursive: true })

    await migrateNestedTopics(USER)

    const id = asTopicName(childId)
    assert.ok(id)
    assert.equal(await topicExists(USER, id), true)
    const topic = await readTopic(USER, id)
    assert.equal(topic.name, '宿の予約')
    assert.deepEqual(topic.tags, ['秋の旅行'])
    assert.equal(await fsp.readFile(tagFile(USER, assertTopicName('秋の旅行')), 'utf8'), '京都に行く\n')
    await assert.rejects(() => fsp.stat(path.join(topicDir(USER, id), 'CLAUDE.md')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => fsp.stat(path.join(topicDir(USER, id), 'summary.md')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => fsp.stat(group), { code: 'ENOENT' })
  })

  it('名前付きの子には新しい id を振る', async () => {
    const group = path.join(topicsDir(USER), '買い物')
    const child = path.join(group, '牛乳')
    await writeJson(path.join(group, 'topic.json'), {
      slug: '買い物',
      name: '買い物',
      emoji: '🛒',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await writeJson(path.join(child, 'topic.json'), {
      slug: '牛乳',
      name: '牛乳',
      emoji: '🥛',
      createdAt: '2026-08-01T00:00:00.000Z',
    })

    await migrateNestedTopics(USER)

    const names = await fsp.readdir(topicsDir(USER))
    assert.equal(names.some((name) => /^\d{2}-\d{2}-\d{2}/.test(name)), true)
    assert.equal(names.includes('買い物'), false)
    assert.equal(names.includes('牛乳'), false)
  })

  it('既にあるタグ本文は触らない', async () => {
    await fsp.mkdir(path.dirname(tagFile(USER, assertTopicName('秋の旅行'))), { recursive: true })
    await fsp.writeFile(tagFile(USER, assertTopicName('秋の旅行')), '残す\n')

    const group = path.join(topicsDir(USER), '秋の旅行')
    await writeJson(path.join(group, 'topic.json'), {
      slug: '秋の旅行',
      name: '秋の旅行',
      emoji: '🍂',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await fsp.writeFile(path.join(group, 'summary.md'), '上書きしない\n')
    await writeJson(path.join(group, 'untitled-20260814-0938', 'topic.json'), {
      slug: 'untitled-20260814-0938',
      name: '',
      emoji: '💬',
      createdAt: '2026-08-14T00:00:00.000Z',
    })

    await migrateNestedTopics(USER)
    assert.equal(await fsp.readFile(tagFile(USER, assertTopicName('秋の旅行')), 'utf8'), '残す\n')
  })

  it('一段なら何もしない', async () => {
    const id = assertTopicName('untitled-20260814-1000')
    await writeJson(path.join(topicDir(USER, id), 'topic.json'), {
      slug: id,
      name: '既に一段',
      emoji: '💬',
      createdAt: '2026-08-14T00:00:00.000Z',
    })

    await migrateNestedTopics(USER)
    assert.equal((await readTopic(USER, id)).name, '既に一段')
  })
})

describe('migrateTopicIds', () => {
  it('untitled フォルダに uuid を振り、日付と見出しへ動かす', async () => {
    const folder = assertTopicName('untitled-20260814-0938')
    await writeJson(path.join(topicDir(USER, folder), 'topic.json'), {
      slug: folder,
      name: '家族構成',
      emoji: '👨',
      createdAt: '2026-08-14T00:38:40.300Z',
    })

    await migrateTopicIds(USER)

    assert.equal(await topicExists(USER, folder), false)
    const dest = assertTopicName('26-08-14-家族構成')
    assert.equal(await topicExists(USER, dest), true)
    const topic = await readTopic(USER, dest)
    assert.match(topic.slug, /^[0-9a-f-]{36}$/)
    assert.equal(topic.name, '家族構成')
    const raw = JSON.parse(await fsp.readFile(path.join(topicDir(USER, dest), 'topic.json'), 'utf8'))
    assert.equal(raw.emoji, '👨')
    assert.equal(raw.id, topic.slug)
    assert.equal(raw.slug, dest)
  })

  it('名前が無い会話は日付だけのフォルダになる', async () => {
    const folder = assertTopicName('untitled-20260815-0033')
    await writeJson(path.join(topicDir(USER, folder), 'topic.json'), {
      slug: folder,
      name: '',
      createdAt: '2026-08-14T15:33:11.011Z',
    })

    await migrateTopicIds(USER)

    const dest = assertTopicName('26-08-15')
    assert.equal(await topicExists(USER, dest), true)
    const found = await resolveTopic(USER, (await readTopic(USER, dest)).slug)
    assert.ok(found)
    assert.equal(found.folder, dest)
  })

  it('すでに揃っている会話は触らない', async () => {
    const dest = assertTopicName('26-08-14-買い物')
    const id = '11111111-2222-4333-8444-555555555555'
    await writeJson(path.join(topicDir(USER, dest), 'topic.json'), {
      slug: dest,
      id,
      name: '買い物',
      createdAt: '2026-08-14T00:00:00.000Z',
    })
    const before = await fsp.readFile(path.join(topicDir(USER, dest), 'topic.json'), 'utf8')

    await migrateTopicIds(USER)

    assert.equal(await fsp.readFile(path.join(topicDir(USER, dest), 'topic.json'), 'utf8'), before)
    assert.equal((await readTopic(USER, dest)).slug, id)
  })
})
