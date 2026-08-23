import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-tag-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const {
  applyOrganize,
  createTag,
  deleteTag,
  ensureTag,
  listTags,
  mergeTags,
  readTag,
  readTagTexts,
  renameTag,
  writeTag,
} = await import('./tag')
const { asTopicName, assertTopicName, assertUser, tagFile, tagsMetaFile } = await import('./paths')
const { createTopic, readTopic } = await import('./topic')
const { ConflictError, NotFoundError } = await import('../errors')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
})

describe('createTag / readTag / writeTag', () => {
  it('作った本文が tags/{name}.md に残る', async () => {
    const tag = await createTag(USER, { name: '秋の旅行', text: '  京都に行く  ', emoji: '🍂' })
    assert.equal(tag.name, '秋の旅行')
    assert.equal(tag.emoji, '🍂')
    assert.equal(tag.group, '')
    assert.equal(tag.text, '京都に行く\n')
    assert.equal(await fsp.readFile(tagFile(USER, assertTopicName('秋の旅行')), 'utf8'), '京都に行く\n')
    assert.equal((await readTag(USER, assertTopicName('秋の旅行'))).text, '京都に行く\n')
  })

  it('同じ名前は ConflictError', async () => {
    const tag = await createTag(USER, { name: '買い物' })
    assert.ok(tag.emoji)
    assert.equal(tag.group, '')
    await assert.rejects(() => createTag(USER, { name: '買い物' }), ConflictError)
  })

  it('名前を変えずに絵文字だけ変えられる', async () => {
    await createTag(USER, { name: '買い物' })
    const next = await renameTag(USER, assertTopicName('買い物'), { emoji: '🛒' })
    assert.equal(next.name, '買い物')
    assert.equal(next.emoji, '🛒')
    assert.equal(next.group, '')
  })

  it('棚を付けて読める。昔の tags.json の文字列も絵文字だけとして読む', async () => {
    const withShelf = await createTag(USER, { name: 'スキンケア', emoji: '🧴', group: '暮らし' })
    assert.equal(withShelf.group, '暮らし')

    await createTag(USER, { name: '学習' })
    await fsp.writeFile(
      tagsMetaFile(USER),
      JSON.stringify({ 学習: '📚', スキンケア: { emoji: '🧴', group: '暮らし' } }, null, 2) + '\n',
    )
    const tags = await listTags(USER)
    assert.equal(tags.find((tag) => tag.name === '学習')?.emoji, '📚')
    assert.equal(tags.find((tag) => tag.name === '学習')?.group, '')
    assert.equal(tags.find((tag) => tag.name === 'スキンケア')?.group, '暮らし')
    assert.deepEqual(
      tags.map((tag) => tag.name),
      ['スキンケア', '学習'],
    )
  })

  it('無いタグは NotFoundError', async () => {
    await assert.rejects(() => readTag(USER, assertTopicName('無い')), NotFoundError)
  })
})

describe('ensureTag', () => {
  it('無いタグなら空ファイルを作る', async () => {
    const name = await ensureTag(USER, '新しい話題', '✨')
    assert.equal(name, '新しい話題')
    assert.equal(await fsp.readFile(tagFile(USER, assertTopicName('新しい話題')), 'utf8'), '')
    assert.equal((await readTag(USER, assertTopicName('新しい話題'))).emoji, '✨')
  })

  it('既にあるタグの絵文字と棚は上書きしない', async () => {
    await createTag(USER, { name: '秋の旅行', emoji: '🍂', group: '旅' })
    await ensureTag(USER, '秋の旅行', '🏨', '仕事')
    const tag = await readTag(USER, assertTopicName('秋の旅行'))
    assert.equal(tag.emoji, '🍂')
    assert.equal(tag.group, '旅')
  })

  it('無いタグなら棚も残す', async () => {
    const name = await ensureTag(USER, '美術館博物館巡り', '🖼️', '文化')
    assert.equal(name, '美術館博物館巡り')
    assert.equal((await readTag(USER, assertTopicName('美術館博物館巡り'))).group, '文化')
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

    const renamed = await renameTag(USER, assertTopicName('旅行'), { name: '秋の旅行', emoji: '🍂' })
    assert.equal(renamed.name, '秋の旅行')
    assert.equal(renamed.emoji, '🍂')
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

describe('mergeTags / applyOrganize', () => {
  it('無い寄せ先なら改名する', async () => {
    await createTag(USER, { name: '大英博物館展', text: '予習した' })
    const topic = await createTopic(USER, { tags: ['大英博物館展'] })
    const merged = await mergeTags(USER, assertTopicName('大英博物館展'), assertTopicName('美術館博物館巡り'))
    assert.equal(merged.name, '美術館博物館巡り')
    assert.match(merged.text, /予習した/)
    assert.deepEqual((await readTopic(USER, asTopicName(topic.slug)!)).tags, ['美術館博物館巡り'])
  })

  it('ある寄せ先なら本文を足して元を消す', async () => {
    await createTag(USER, { name: '旅行', text: '秋に行く', group: '旅' })
    await createTag(USER, { name: '四国旅', text: '宿を探す' })
    const topic = await createTopic(USER, { tags: ['四国旅'] })
    const merged = await mergeTags(USER, assertTopicName('四国旅'), assertTopicName('旅行'))
    assert.equal(merged.name, '旅行')
    assert.match(merged.text, /秋に行く/)
    assert.match(merged.text, /宿を探す/)
    assert.equal(merged.group, '旅')
    await assert.rejects(() => readTag(USER, assertTopicName('四国旅')), NotFoundError)
    assert.deepEqual((await readTopic(USER, asTopicName(topic.slug)!)).tags, ['旅行'])
  })

  it('選んだ項目だけ書く', async () => {
    await createTag(USER, { name: '大英博物館展' })
    await createTag(USER, { name: '動作確認用' })
    await createTag(USER, { name: 'スキンケア' })
    const next = await applyOrganize(USER, [
      { type: 'merge', from: '大英博物館展', to: '美術館博物館巡り' },
      { type: 'shelf', name: '美術館博物館巡り', group: '文化' },
      { type: 'shelf', name: 'スキンケア', group: '暮らし' },
      { type: 'remove', name: '動作確認用' },
    ])
    assert.deepEqual(
      next.map((tag) => [tag.name, tag.group]),
      [
        ['美術館博物館巡り', '文化'],
        ['スキンケア', '暮らし'],
      ],
    )
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
