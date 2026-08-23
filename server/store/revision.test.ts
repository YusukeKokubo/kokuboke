import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-rev-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { appendRevision, formatRevisions, readRevisions, splitOrganizeActions } =
  await import('./revision')
const { createTopic, readMeta, renameTopic, resolveTopic, writeTags } = await import('./topic')
const { assertUser, revisionsFile } = await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

beforeEach(async () => {
  await fsp.rm(path.join(dataDir, 'taro'), { recursive: true, force: true })
})

async function folderOf(slug: string) {
  const found = await resolveTopic(USER, slug)
  assert.ok(found)
  return found.folder
}

describe('appendRevision / readRevisions', () => {
  it('同じ対は書かない', async () => {
    assert.equal(
      await appendRevision(USER, { kind: 'name', from: '夕食', to: '夕食' }),
      null,
    )
    assert.equal(
      await appendRevision(USER, { kind: 'tag', from: ['旅行'], to: ['旅行'] }),
      null,
    )
    assert.equal(await appendRevision(USER, { kind: 'organize', accepted: [], rejected: [] }), null)
    await assert.rejects(() => fsp.stat(revisionsFile(USER)), { code: 'ENOENT' })
  })

  it('変わった対だけ追記する', async () => {
    const written = await appendRevision(USER, {
      kind: 'name',
      from: '夕食の件',
      to: '夕食の相談',
      topic: 'id-1',
    })
    assert.ok(written)
    assert.equal(written.kind, 'name')
    const lines = (await fsp.readFile(revisionsFile(USER), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1)
    const list = await readRevisions(USER)
    assert.equal(list.length, 1)
    assert.equal(list[0]?.kind, 'name')
    if (list[0]?.kind === 'name') assert.equal(list[0].to, '夕食の相談')
  })

  it('新しい方から数えて limit 件', async () => {
    for (let i = 0; i < 5; i++) {
      await appendRevision(USER, { kind: 'name', from: `旧${i}`, to: `新${i}` })
    }
    const last = await readRevisions(USER, 2)
    assert.equal(last.length, 2)
    assert.equal(last[0]?.kind, 'name')
    if (last[0]?.kind === 'name') assert.equal(last[0].to, '新3')
    if (last[1]?.kind === 'name') assert.equal(last[1].to, '新4')
  })
})

describe('splitOrganizeActions', () => {
  it('選ばなかった案を rejected にする', () => {
    const proposed = [
      { type: 'merge' as const, from: '大英博物館展', to: '美術館博物館巡り' },
      { type: 'remove' as const, name: '動作確認用' },
    ]
    const { accepted, rejected } = splitOrganizeActions(proposed, [proposed[0]!])
    assert.deepEqual(accepted, [proposed[0]])
    assert.deepEqual(rejected, [proposed[1]])
  })
})

describe('formatRevisions', () => {
  it('見出しとタグと整理を短い行にする', () => {
    const text = formatRevisions([
      { at: '2026-08-23T00:00:00.000Z', kind: 'name', from: '夕食の件', to: '夕食の相談' },
      { at: '2026-08-23T00:00:01.000Z', kind: 'tag', from: ['大英博物館展'], to: ['美術館博物館巡り'] },
      {
        at: '2026-08-23T00:00:02.000Z',
        kind: 'organize',
        accepted: [{ type: 'merge', from: '大英博物館展', to: '美術館博物館巡り' }],
        rejected: [{ type: 'remove', name: '動作確認用' }],
      },
    ])
    assert.match(text, /見出し: 「夕食の件」→「夕食の相談」/)
    assert.match(text, /タグ: \[大英博物館展\] → \[美術館博物館巡り\]/)
    assert.match(text, /採用: 「大英博物館展」→「美術館博物館巡り」/)
    assert.match(text, /見送り: 「動作確認用」を削除/)
  })
})

describe('renameTopic / writeTags と revisions', () => {
  it('人が付け直した見出しは残り、自動の命名は残さない', async () => {
    const topic = await createTopic(USER, { name: '仮' })
    await renameTopic(USER, topic.slug, { name: '自動', autoAt: 1 })
    assert.equal((await readRevisions(USER)).length, 0)
    assert.equal((await readMeta(USER, await folderOf(topic.slug))).proposedName, '自動')

    await renameTopic(USER, topic.slug, { name: '自分で付けた' })
    const list = await readRevisions(USER)
    assert.equal(list.length, 1)
    assert.equal(list[0]?.kind, 'name')
    if (list[0]?.kind === 'name') {
      assert.equal(list[0].from, '自動')
      assert.equal(list[0].to, '自分で付けた')
    }
  })

  it('人が付け外したタグは残り、自動の配列は残さない', async () => {
    const topic = await createTopic(USER, {})
    await writeTags(USER, topic.slug, ['旅行'], { proposed: true })
    assert.equal((await readRevisions(USER)).length, 0)
    assert.deepEqual((await readMeta(USER, await folderOf(topic.slug))).proposedTags, ['旅行'])

    await writeTags(USER, topic.slug, ['美術館博物館巡り'])
    const list = await readRevisions(USER)
    assert.equal(list.length, 1)
    assert.equal(list[0]?.kind, 'tag')
    if (list[0]?.kind === 'tag') {
      assert.deepEqual(list[0].from, ['旅行'])
      assert.deepEqual(list[0].to, ['美術館博物館巡り'])
    }
  })
})
