import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import type { Message } from '../../shared/types'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
process.env.TZ = 'Asia/Tokyo'

const { appendMessage, countUserMessages, readAll, readLastEntry, readRecent } = await import('./log')
const { localDate, stamp } = await import('./date')
const { assertTopicRef, assertUser, logsDir } = await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')
const TOPIC = assertTopicRef('math')

function message(text: string, at: Date, images: string[] = []): Message {
  return { id: crypto.randomUUID(), role: 'user', text, images, at: at.toISOString() }
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

beforeEach(async () => {
  await fsp.rm(logsDir(USER, TOPIC), { recursive: true, force: true })
})

describe('appendMessage と readRecent', () => {
  it('書いたものを同じ順で読み戻せる', async () => {
    await appendMessage(USER, TOPIC, message('ひとつめ', new Date()))
    await appendMessage(USER, TOPIC, message('ふたつめ', new Date()))

    const read = await readRecent(USER, TOPIC, 1)
    assert.deepEqual(
      read.map((m) => m.text),
      ['ひとつめ', 'ふたつめ'],
    )
  })

  it('日をまたいだものを古い順に並べる', async () => {
    await appendMessage(USER, TOPIC, message('きのう', daysAgo(1)))
    await appendMessage(USER, TOPIC, message('きょう', new Date()))

    const read = await readRecent(USER, TOPIC, 3)
    assert.deepEqual(
      read.map((m) => m.text),
      ['きのう', 'きょう'],
    )
  })

  it('days の外に出たものは読まない', async () => {
    await appendMessage(USER, TOPIC, message('むかし', daysAgo(5)))
    await appendMessage(USER, TOPIC, message('きょう', new Date()))

    const read = await readRecent(USER, TOPIC, 2)
    assert.deepEqual(
      read.map((m) => m.text),
      ['きょう'],
    )
  })

  it('ログが無いトピックは空を返す', async () => {
    assert.deepEqual(await readRecent(USER, assertTopicRef('not-yet'), 3), [])
  })

  it('壊れた行は捨てて残りを読む', async () => {
    await appendMessage(USER, TOPIC, message('無事', new Date()))
    const file = path.join(logsDir(USER, TOPIC), `${localDate().replaceAll('-', '')}.jsonl`)
    await fsp.appendFile(file, '{壊れた行\n')
    await appendMessage(USER, TOPIC, message('こっちも無事', new Date()))

    const read = await readRecent(USER, TOPIC, 1)
    assert.deepEqual(
      read.map((m) => m.text),
      ['無事', 'こっちも無事'],
    )
  })
})

describe('readAll', () => {
  it('days の外も含めて古い順に返す', async () => {
    await appendMessage(USER, TOPIC, message('むかし', daysAgo(5)))
    await appendMessage(USER, TOPIC, message('きのう', daysAgo(1)))
    await appendMessage(USER, TOPIC, message('きょう', new Date()))

    const read = await readAll(USER, TOPIC)
    assert.deepEqual(
      read.map((m) => m.text),
      ['むかし', 'きのう', 'きょう'],
    )
  })

  it('ログが無いトピックは空を返す', async () => {
    assert.deepEqual(await readAll(USER, assertTopicRef('not-yet')), [])
  })
})

describe('readLastEntry', () => {
  it('いちばん新しい発言を返す', async () => {
    await appendMessage(USER, TOPIC, message('きのう', daysAgo(1)))
    await appendMessage(USER, TOPIC, message('さいご', new Date()))

    assert.equal((await readLastEntry(USER, TOPIC))?.text, 'さいご')
  })

  it('まだ話していないトピックは null', async () => {
    assert.equal(await readLastEntry(USER, assertTopicRef('not-yet')), null)
  })

  it('最新のファイルが空でも、その前のファイルから最後の一件を拾う', async () => {
    await appendMessage(USER, TOPIC, message('きのうのさいご', daysAgo(1)))
    const empty = path.join(logsDir(USER, TOPIC), `${stamp(localDate())}.jsonl`)
    await fsp.writeFile(empty, '')

    assert.equal((await readLastEntry(USER, TOPIC))?.text, 'きのうのさいご')
  })

  it('最新が壊れた行だけでも、その前のファイルから拾う', async () => {
    await appendMessage(USER, TOPIC, message('きのうのさいご', daysAgo(1)))
    const broken = path.join(logsDir(USER, TOPIC), `${stamp(localDate())}.jsonl`)
    await fsp.writeFile(broken, '{壊れた行\n\n')

    assert.equal((await readLastEntry(USER, TOPIC))?.text, 'きのうのさいご')
  })

  it('30 日より前のログでも拾える', async () => {
    await appendMessage(USER, TOPIC, message('むかしのさいご', daysAgo(60)))

    assert.equal((await readLastEntry(USER, TOPIC))?.text, 'むかしのさいご')
  })
})

describe('countUserMessages', () => {
  it('本人の発言だけを数える', async () => {
    await appendMessage(USER, TOPIC, message('いち', daysAgo(2)))
    await appendMessage(USER, TOPIC, {
      ...message('へんじ', daysAgo(2)),
      role: 'assistant',
    })
    await appendMessage(USER, TOPIC, message('に', daysAgo(1)))

    assert.equal(await countUserMessages(USER, TOPIC), 2)
  })

  it('stopAt に達したら残りのファイルは読まない', async () => {
    await appendMessage(USER, TOPIC, message('いち', daysAgo(2)))
    await appendMessage(USER, TOPIC, message('に', daysAgo(2)))
    await appendMessage(USER, TOPIC, message('さん', daysAgo(1)))
    await appendMessage(USER, TOPIC, message('よん', daysAgo(1)))
    await appendMessage(USER, TOPIC, message('ご', new Date()))

    assert.equal(await countUserMessages(USER, TOPIC), 5)
    assert.equal(await countUserMessages(USER, TOPIC, 3), 3)
  })
})

describe('人が読む md', () => {
  it('日付の見出しは一日に一度だけ置く', async () => {
    await appendMessage(USER, TOPIC, message('ひとつめ', new Date()))
    await appendMessage(USER, TOPIC, message('ふたつめ', new Date()))

    const today = localDate()
    const md = await fsp.readFile(
      path.join(logsDir(USER, TOPIC), `${today.replaceAll('-', '')}.md`),
      'utf8',
    )
    assert.equal(md.match(new RegExp(`^# ${today}$`, 'gm'))?.length, 1)
    assert.ok(md.includes('ひとつめ'))
    assert.ok(md.includes('ふたつめ'))
  })

  it('画像は md の隣を指す相対パスで書く', async () => {
    await appendMessage(USER, TOPIC, message('写真', new Date(), ['20260809_120000_ab12.jpg']))

    const md = await fsp.readFile(
      path.join(logsDir(USER, TOPIC), `${localDate().replaceAll('-', '')}.md`),
      'utf8',
    )
    assert.ok(
      md.includes('![](images/20260809_120000_ab12.jpg)'),
      `md の中身が想定と違う:\n${md}`,
    )
  })
})
