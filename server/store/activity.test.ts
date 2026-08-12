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

const { listRecentActivity } = await import('./activity')
const { appendMessage } = await import('./log')
const { createTopic } = await import('./topic')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

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
  it('本人の送信だけを新しい順に返す', async () => {
    const parent = await createTopic('taro', { name: '勉強' })
    const child = await createTopic('taro', { name: '算数', emoji: '📐' }, parent.slug)

    const older = new Date('2026-08-10T10:00:00+09:00')
    const newer = new Date('2026-08-11T12:00:00+09:00')
    const ref = { topic: parent.slug, sub: child.slug }

    await appendMessage('taro', ref, message('きのうの質問', older))
    await appendMessage('taro', ref, message('AIの返事', older, 'assistant'))
    await appendMessage('taro', ref, message('きょうの質問', newer))

    const entries = await listRecentActivity(50)
    assert.deepEqual(
      entries.map((e) => e.text),
      ['きょうの質問', 'きのうの質問'],
    )
    assert.equal(entries[0]?.user, 'taro')
    assert.equal(entries[0]?.topic, parent.slug)
    assert.equal(entries[0]?.sub, child.slug)
    assert.equal(entries[0]?.emoji, '📐')
    assert.equal(entries[0]?.topicName, '勉強')
    assert.equal(entries[0]?.subName, '算数')
  })

  it('ユーザーをまたいでも新しい順に並べる', async () => {
    const a = await createTopic('taro', { name: 'A' })
    const aChild = await createTopic('taro', { name: 'a1' }, a.slug)
    const b = await createTopic('hanako', { name: 'B' })
    const bChild = await createTopic('hanako', { name: 'b1' }, b.slug)

    await appendMessage(
      'taro',
      { topic: a.slug, sub: aChild.slug },
      message('太郎', new Date('2026-08-10T09:00:00+09:00')),
    )
    await appendMessage(
      'hanako',
      { topic: b.slug, sub: bChild.slug },
      message('花子', new Date('2026-08-11T09:00:00+09:00')),
    )

    const entries = await listRecentActivity(50)
    assert.deepEqual(
      entries.map((e) => e.user),
      ['hanako', 'taro'],
    )
  })

  it('limit で切り捨てる', async () => {
    const parent = await createTopic('taro', { name: '器' })
    const child = await createTopic('taro', { name: '子' }, parent.slug)
    const ref = { topic: parent.slug, sub: child.slug }

    await appendMessage('taro', ref, message('いち', new Date('2026-08-10T10:00:00+09:00')))
    await appendMessage('taro', ref, message('に', new Date('2026-08-10T11:00:00+09:00')))
    await appendMessage('taro', ref, message('さん', new Date('2026-08-10T12:00:00+09:00')))

    const entries = await listRecentActivity(2)
    assert.deepEqual(
      entries.map((e) => e.text),
      ['さん', 'に'],
    )
  })

  it('空白を畳んで抜粋する', async () => {
    const parent = await createTopic('taro', { name: '器' })
    const child = await createTopic('taro', { name: '子' }, parent.slug)
    const long = 'あ'.repeat(100)
    await appendMessage(
      'taro',
      { topic: parent.slug, sub: child.slug },
      message(`  行1\n\n行2  ${long}`, new Date()),
    )

    const [entry] = await listRecentActivity(1)
    assert.ok(entry)
    assert.ok(!entry.text.includes('\n'))
    assert.equal(entry.text.length, 80)
  })
})
