import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import type { Message } from '../../shared/types'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-activity-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro,hanako'
process.env.TZ = 'Asia/Tokyo'

const { readFamilyActivity, listRecentActivity } = await import('./activity')
const { appendMessage } = await import('./log')
const { assertUser, familyUser } = await import('./paths')
const { createTopic, resolveTopic } = await import('./topic')
const { ensureFamily } = await import('./user')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

async function folderOf(user: ReturnType<typeof assertUser>, slug: string) {
  const found = await resolveTopic(user, slug)
  assert.ok(found)
  return found.folder
}

function message(
  text: string,
  at: Date,
  role: Message['role'] = 'user',
  images: string[] = [],
): Message {
  return { id: crypto.randomUUID(), role, text, images, at: at.toISOString() }
}

beforeEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true })
  await fsp.mkdir(dataDir, { recursive: true })
})

describe('listRecentActivity', () => {
  it('ユーザーごとに最新の会話だけを返す', async () => {
    const math = await createTopic(assertUser('taro'), { name: '算数' })
    const history = await createTopic(assertUser('taro'), { name: '歴史' })

    await appendMessage(
      assertUser('taro'),
      await folderOf(assertUser('taro'), math.slug),
      message('算数の質問', new Date('2026-08-11T12:00:00+09:00')),
    )
    await appendMessage(
      assertUser('taro'),
      await folderOf(assertUser('taro'), history.slug),
      message('歴史の質問', new Date('2026-08-10T10:00:00+09:00')),
    )

    const entries = await listRecentActivity()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.user, 'taro')
    assert.equal(entries[0]?.slug, math.slug)
    assert.equal(entries[0]?.text, '算数の質問')
    assert.equal(entries[0]?.name, '算数')
  })

  it('同じ会話の古い発言は出さない', async () => {
    const topic = await createTopic(assertUser('taro'), { name: '子' })
    const id = await folderOf(assertUser('taro'), topic.slug)

    await appendMessage(assertUser('taro'), id, message('きのう', new Date('2026-08-10T10:00:00+09:00')))
    await appendMessage(assertUser('taro'), id, message('きょう', new Date('2026-08-11T12:00:00+09:00')))

    const entries = await listRecentActivity()
    assert.deepEqual(
      entries.map((e) => e.text),
      ['きょう'],
    )
  })

  it('ユーザーをまたいでも新しい順に並べる', async () => {
    const a = await createTopic(assertUser('taro'), { name: 'A' })
    const b = await createTopic(assertUser('hanako'), { name: 'B' })

    await appendMessage(
      assertUser('taro'),
      await folderOf(assertUser('taro'), a.slug),
      message('太郎', new Date('2026-08-10T09:00:00+09:00')),
    )
    await appendMessage(
      assertUser('hanako'),
      await folderOf(assertUser('hanako'), b.slug),
      message('花子', new Date('2026-08-11T09:00:00+09:00')),
    )

    const entries = await listRecentActivity()
    assert.deepEqual(
      entries.map((e) => e.user),
      ['hanako', 'taro'],
    )
  })

  it('話していないユーザーは出さない', async () => {
    await createTopic(assertUser('taro'), { name: '子' })
    assert.deepEqual(await listRecentActivity(), [])
  })

  it('新しい空の会話があっても、話した会話の方を取る', async () => {
    const old = await createTopic(assertUser('taro'), { name: '古い話' })
    await appendMessage(
      assertUser('taro'),
      await folderOf(assertUser('taro'), old.slug),
      message('昨日の話', new Date('2026-08-10T10:00:00+09:00')),
    )
    await createTopic(assertUser('taro'), { name: '新しい話' })

    const entries = await listRecentActivity()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.name, '古い話')
    assert.equal(entries[0]?.text, '昨日の話')
  })

  it('空白を畳んで抜粋する', async () => {
    const topic = await createTopic(assertUser('taro'), { name: '子' })
    const long = 'あ'.repeat(100)
    await appendMessage(
      assertUser('taro'),
      await folderOf(assertUser('taro'), topic.slug),
      message(`  行1\n\n行2  ${long}`, new Date()),
    )

    const [entry] = await listRecentActivity()
    assert.ok(entry)
    assert.ok(!entry.text.includes('\n'))
    assert.equal(entry.text.length, 80)
  })
})

describe('readFamilyActivity', () => {
  beforeEach(async () => {
    await ensureFamily()
  })

  it('まだ誰も話していなければ null', async () => {
    assert.equal(await readFamilyActivity(), null)
  })

  it('いちばん新しい会話を一行返す', async () => {
    const user = familyUser()
    const topic = await createTopic(user, { name: '買い物' })
    await appendMessage(user, await folderOf(user, topic.slug), {
      ...message('牛乳', new Date()),
      author: 'taro',
    })

    const entry = await readFamilyActivity()
    assert.ok(entry)
    assert.equal(entry.name, '買い物')
    assert.equal(entry.text, '牛乳')
    assert.equal(entry.author, 'taro')
  })
})
