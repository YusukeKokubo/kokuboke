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
const { assertTopicName, assertTopicRef, assertUser } = await import('./paths')
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
  it('ユーザーごとに最新の会話だけを返す', async () => {
    const parent = await createTopic(assertUser('taro'), { name: '勉強' })
    const math = await createTopic(assertUser('taro'), { name: '算数', emoji: '📐' }, assertTopicName(parent.slug))
    const history = await createTopic(assertUser('taro'), { name: '歴史' }, assertTopicName(parent.slug))

    await appendMessage(
      assertUser('taro'),
      assertTopicRef(parent.slug, assertTopicName(math.slug)),
      message('算数の質問', new Date('2026-08-11T12:00:00+09:00')),
    )
    await appendMessage(
      assertUser('taro'),
      assertTopicRef(parent.slug, assertTopicName(history.slug)),
      message('歴史の質問', new Date('2026-08-10T10:00:00+09:00')),
    )

    const entries = await listRecentActivity()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.user, 'taro')
    assert.equal(entries[0]?.sub, assertTopicName(math.slug))
    assert.equal(entries[0]?.text, '算数の質問')
    assert.equal(entries[0]?.emoji, '📐')
    assert.equal(entries[0]?.topicName, '勉強')
    assert.equal(entries[0]?.subName, '算数')
  })

  it('同じ会話の古い発言は出さない', async () => {
    const parent = await createTopic(assertUser('taro'), { name: '器' })
    const child = await createTopic(assertUser('taro'), { name: '子' }, assertTopicName(parent.slug))
    const ref = assertTopicRef(parent.slug, assertTopicName(child.slug))

    await appendMessage(assertUser('taro'), ref, message('きのう', new Date('2026-08-10T10:00:00+09:00')))
    await appendMessage(assertUser('taro'), ref, message('きょう', new Date('2026-08-11T12:00:00+09:00')))

    const entries = await listRecentActivity()
    assert.deepEqual(
      entries.map((e) => e.text),
      ['きょう'],
    )
  })

  it('ユーザーをまたいでも新しい順に並べる', async () => {
    const a = await createTopic(assertUser('taro'), { name: 'A' })
    const aChild = await createTopic(assertUser('taro'), { name: 'a1' }, assertTopicName(a.slug))
    const b = await createTopic(assertUser('hanako'), { name: 'B' })
    const bChild = await createTopic(assertUser('hanako'), { name: 'b1' }, assertTopicName(b.slug))

    await appendMessage(
      assertUser('taro'),
      assertTopicRef(a.slug, assertTopicName(aChild.slug)),
      message('太郎', new Date('2026-08-10T09:00:00+09:00')),
    )
    await appendMessage(
      assertUser('hanako'),
      assertTopicRef(b.slug, assertTopicName(bChild.slug)),
      message('花子', new Date('2026-08-11T09:00:00+09:00')),
    )

    const entries = await listRecentActivity()
    assert.deepEqual(
      entries.map((e) => e.user),
      ['hanako', 'taro'],
    )
  })

  it('話していないユーザーは出さない', async () => {
    const parent = await createTopic(assertUser('taro'), { name: '器' })
    await createTopic(assertUser('taro'), { name: '子' }, assertTopicName(parent.slug))

    assert.deepEqual(await listRecentActivity(), [])
  })

  it('新しい空の器があっても、話した会話の方を取る', async () => {
    const old = await createTopic(assertUser('taro'), { name: '古い器' })
    const child = await createTopic(assertUser('taro'), { name: '子' }, assertTopicName(old.slug))
    await appendMessage(
      assertUser('taro'),
      assertTopicRef(old.slug, assertTopicName(child.slug)),
      message('昨日の話', new Date('2026-08-10T10:00:00+09:00')),
    )
    await createTopic(assertUser('taro'), { name: '新しい器' })

    const entries = await listRecentActivity()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.topicName, '古い器')
    assert.equal(entries[0]?.text, '昨日の話')
  })

  it('空白を畳んで抜粋する', async () => {
    const parent = await createTopic(assertUser('taro'), { name: '器' })
    const child = await createTopic(assertUser('taro'), { name: '子' }, assertTopicName(parent.slug))
    const long = 'あ'.repeat(100)
    await appendMessage(
      assertUser('taro'),
      assertTopicRef(parent.slug, assertTopicName(child.slug)),
      message(`  行1\n\n行2  ${long}`, new Date()),
    )

    const [entry] = await listRecentActivity()
    assert.ok(entry)
    assert.ok(!entry.text.includes('\n'))
    assert.equal(entry.text.length, 80)
  })
})
