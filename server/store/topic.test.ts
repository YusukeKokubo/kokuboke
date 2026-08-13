import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { createTopic, readChildSources, readClaude, writeClaude, writeSummary } =
  await import('./topic')
const { appendMessage } = await import('./log')
const { assertTopicName, assertTopicRef, assertUser, topicDir } = await import('./paths')

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
