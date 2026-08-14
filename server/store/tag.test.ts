import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-tag-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { createTag, deleteTag, ensureTag, listTags, readTag, readTagTexts, renameTag, writeTag } =
  await import('./tag')
const { asTopicName, assertTopicName, assertUser, tagFile } = await import('./paths')
const { createTopic, readTopic } = await import('./topic')
const { ConflictError, NotFoundError } = await import('../errors')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
})

describe('createTag / readTag / writeTag', () => {
  it('作った本文が tags/{name}.md に残る', async () => {
    const tag = await createTag(USER, { name: '秋の旅行', text: '  京都に行く  ' })
    assert.equal(tag.name, '秋の旅行')
    assert.equal(tag.text, '京都に行く\n')
    assert.equal(await fsp.readFile(tagFile(USER, assertTopicName('秋の旅行')), 'utf8'), '京都に行く\n')
    assert.equal((await readTag(USER, assertTopicName('秋の旅行'))).text, '京都に行く\n')
  })

  it('同じ名前は ConflictError', async () => {
    await createTag(USER, { name: '買い物' })
    await assert.rejects(() => createTag(USER, { name: '買い物' }), ConflictError)
  })

  it('無いタグは NotFoundError', async () => {
    await assert.rejects(() => readTag(USER, assertTopicName('無い')), NotFoundError)
  })
})

describe('ensureTag', () => {
  it('無いタグなら空ファイルを作る', async () => {
    const name = await ensureTag(USER, '新しい話題')
    assert.equal(name, '新しい話題')
    assert.equal(await fsp.readFile(tagFile(USER, assertTopicName('新しい話題')), 'utf8'), '')
  })

  it('既にあるファイルは触らない', async () => {
    await writeTag(USER, assertTopicName('秋の旅行'), '残す')
    await ensureTag(USER, '秋の旅行')
    assert.equal(await fsp.readFile(tagFile(USER, assertTopicName('秋の旅行')), 'utf8'), '残す\n')
  })
})

describe('renameTag / deleteTag', () => {
  it('ファイルを動かし、会話の配列も付け替える', async () => {
    await createTag(USER, { name: '旅行' })
    const topic = await createTopic(USER, { tags: ['旅行'] })
    const id = asTopicName(topic.slug)
    assert.ok(id)

    const renamed = await renameTag(USER, assertTopicName('旅行'), { name: '秋の旅行' })
    assert.equal(renamed.name, '秋の旅行')
    assert.deepEqual((await readTopic(USER, id)).tags, ['秋の旅行'])
    await assert.rejects(() => fsp.stat(tagFile(USER, assertTopicName('旅行'))), { code: 'ENOENT' })
  })

  it('消すと会話の配列からも外れる', async () => {
    await createTag(USER, { name: '買い物' })
    const topic = await createTopic(USER, { tags: ['買い物'] })
    const id = asTopicName(topic.slug)
    assert.ok(id)

    await deleteTag(USER, assertTopicName('買い物'))
    assert.deepEqual((await readTopic(USER, id)).tags, [])
    await assert.rejects(() => readTag(USER, assertTopicName('買い物')), NotFoundError)
  })
})

describe('listTags / readTagTexts', () => {
  it('名前順に並べる', async () => {
    await createTag(USER, { name: '買い物' })
    await createTag(USER, { name: '秋の旅行' })
    assert.deepEqual(
      (await listTags(USER)).map((tag) => tag.name),
      ['秋の旅行', '買い物'],
    )
  })

  it('付いている分だけ本文を返す', async () => {
    await writeTag(USER, assertTopicName('秋の旅行'), '京都')
    const tags = await readTagTexts(USER, ['秋の旅行', '../secret'])
    assert.equal(tags.length, 1)
    assert.equal(tags[0]?.name, '秋の旅行')
    assert.match(tags[0]?.text ?? '', /京都/)
  })
})
