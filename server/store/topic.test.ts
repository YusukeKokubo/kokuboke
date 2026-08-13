import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { createTopic, deleteTopic, readChildSources, readClaude, topicExists, writeClaude, writeSummary } =
  await import('./topic')
const { appendMessage, readAll } = await import('./log')
const { assertTopicName, assertTopicRef, assertUser, imagesDir, logsDir, topicDir } =
  await import('./paths')
const { NotFoundError } = await import('../errors')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')
const REF = assertTopicRef('math')

beforeEach(async () => {
  const dir = topicDir(USER, REF)
  await fsp.rm(dir, { recursive: true, force: true })
  await fsp.mkdir(dir, { recursive: true })
})

describe('トピックの CLAUDE.md', () => {
  it('無いファイルは空文字', async () => {
    assert.equal(await readClaude(USER, REF), '')
  })

  it('書いたものが topicDir の CLAUDE.md に残る', async () => {
    await writeClaude(USER, REF, '  答えを先に出さない  ')
    const file = path.join(topicDir(USER, REF), 'CLAUDE.md')
    assert.equal(await fsp.readFile(file, 'utf8'), '答えを先に出さない\n')
    assert.equal(await readClaude(USER, REF), '答えを先に出さない\n')
  })

  it('子トピックも同じ関数で読める', async () => {
    const child = assertTopicRef('math', '分数')
    await fsp.mkdir(topicDir(USER, child), { recursive: true })
    await writeClaude(USER, child, '途中式を見る')
    assert.equal(await readClaude(USER, child), '途中式を見る\n')
    assert.equal(await readClaude(USER, REF), '')
  })
})

describe('readChildSources', () => {
  const parent = assertTopicRef('器')

  beforeEach(async () => {
    await fsp.rm(topicDir(USER, parent), { recursive: true, force: true })
  })

  it('中のトピックの要約と直近の会話を返す', async () => {
    const group = await createTopic(USER, { name: '器' })
    const child = await createTopic(USER, { name: '買い物' }, assertTopicName(group.slug))
    const ref = assertTopicRef(group.slug, child.slug)

    await writeSummary(USER, ref, '牛乳が切れている')
    await appendMessage(USER, ref, {
      id: '1',
      role: 'user',
      text: '卵も足して',
      images: [],
      at: new Date().toISOString(),
    })

    const sources = await readChildSources(USER, assertTopicName(group.slug), 3)
    assert.equal(sources.length, 1)
    assert.equal(sources[0]?.name, '買い物')
    assert.equal(sources[0]?.summary.trim(), '牛乳が切れている')
    assert.deepEqual(
      sources[0]?.history.map((m) => m.text),
      ['卵も足して'],
    )
  })

  it('会話が無い子は history が空', async () => {
    await createTopic(USER, { name: '器' })
    await createTopic(USER, { name: '買い物' }, assertTopicName('器'))

    const sources = await readChildSources(USER, assertTopicName('器'), 3)
    assert.equal(sources.length, 1)
    assert.deepEqual(sources[0]?.history, [])
  })

  it('中が無ければ空', async () => {
    await createTopic(USER, { name: '器' })
    assert.deepEqual(await readChildSources(USER, assertTopicName('器'), 3), [])
  })
})

describe('deleteTopic', () => {
  it('子トピックだけを削除できる', async () => {
    const group = `器-削除-${crypto.randomUUID().slice(0, 8)}`
    await createTopic(USER, { name: group })
    await createTopic(USER, { name: '子その1' }, assertTopicName(group))
    await createTopic(USER, { name: '子その2' }, assertTopicName(group))

    await deleteTopic(USER, assertTopicRef(group, '子その1'))

    assert.equal(await topicExists(USER, assertTopicRef(group, '子その1')), false)
    assert.equal(await topicExists(USER, assertTopicRef(group, '子その2')), true)
  })

  it('器を削除すると中の子も一緒に消える', async () => {
    const group = `器-丸ごと-${crypto.randomUUID().slice(0, 8)}`
    await createTopic(USER, { name: group })
    await createTopic(USER, { name: '子' }, assertTopicName(group))

    await deleteTopic(USER, assertTopicRef(group))

    assert.equal(await topicExists(USER, assertTopicRef(group)), false)
    assert.equal(await topicExists(USER, assertTopicRef(group, '子')), false)
  })

  it('実体が無ければ NotFoundError', async () => {
    await assert.rejects(
      () => deleteTopic(USER, assertTopicRef(`器-無い-${crypto.randomUUID().slice(0, 8)}`)),
      NotFoundError,
    )
  })

  it('logs と images の中身まで消える', async () => {
    const group = `器-残骸-${crypto.randomUUID().slice(0, 8)}`
    await createTopic(USER, { name: group })
    await createTopic(USER, { name: '子' }, assertTopicName(group))
    const ref = assertTopicRef(group, '子')

    await appendMessage(USER, ref, {
      id: '1',
      role: 'user',
      text: '消える発言',
      images: [],
      at: new Date().toISOString(),
    })
    await fsp.writeFile(path.join(imagesDir(USER, ref), '20260813_120000_ab12.jpg'), 'dummy')

    await deleteTopic(USER, ref)

    await assert.rejects(() => fsp.readdir(logsDir(USER, ref)), { code: 'ENOENT' })
    await assert.rejects(() => fsp.readdir(imagesDir(USER, ref)), { code: 'ENOENT' })
  })

  it('同じ名前で作り直しても前の会話は見えない', async () => {
    const group = `器-作り直し-${crypto.randomUUID().slice(0, 8)}`
    await createTopic(USER, { name: group })
    await createTopic(USER, { name: '子' }, assertTopicName(group))
    const ref = assertTopicRef(group, '子')

    await appendMessage(USER, ref, {
      id: '1',
      role: 'assistant',
      text: '前のトピックの返事',
      images: [],
      at: new Date().toISOString(),
    })

    await deleteTopic(USER, ref)
    await createTopic(USER, { name: '子' }, assertTopicName(group))

    assert.deepEqual(await readAll(USER, ref), [])
  })

  /**
   * 削除とすれ違った POST が logs を作り直すと、topic.json の無いフォルダが残る。
   * そこへ同じ名前で作り直しても、消えた会話までは戻らないことを押さえる。
   * すれ違い自体は messages 側の topicExists で塞ぐ。
   */
  it('消したあとに書かれても、前の会話は作り直したトピックに出てこない', async () => {
    const group = `器-すれ違い-${crypto.randomUUID().slice(0, 8)}`
    await createTopic(USER, { name: group })
    await createTopic(USER, { name: '子' }, assertTopicName(group))
    const ref = assertTopicRef(group, '子')

    await appendMessage(USER, ref, {
      id: '1',
      role: 'assistant',
      text: '前のトピックの返事',
      images: [],
      at: new Date().toISOString(),
    })

    await deleteTopic(USER, ref)
    await appendMessage(USER, ref, {
      id: '2',
      role: 'user',
      text: 'すれ違って届いた発言',
      images: [],
      at: new Date().toISOString(),
    })
    await createTopic(USER, { name: '子' }, assertTopicName(group))

    const texts = (await readAll(USER, ref)).map((m) => m.text)
    assert.ok(!texts.includes('前のトピックの返事'), `消した会話が残っている: ${texts.join(' / ')}`)
  })
})
