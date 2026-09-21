import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const {
  ensureFamily,
  ensureUser,
  readAgents,
  readOrganize,
  readProfile,
  writeAgents,
  writeOrganize,
  writeProfile,
  readMemory,
  appendMemory,
  migratePersonaFile,
  removeChatAgentsLink,
} = await import('./user')
const { assertUser, familyUser, organizeFile, tagsDir, userDir, memoryFile } = await import('./paths')
const { createTopic, resolveTopic } = await import('./topic')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')

beforeEach(async () => {
  await fsp.rm(userDir(USER), { recursive: true, force: true })
  await ensureUser(USER)
})

describe('profile.md', () => {
  it('無いファイルは空文字', async () => {
    await fsp.unlink(path.join(userDir(USER), 'profile.md'))
    assert.equal(await readProfile(USER), '')
  })

  it('書いたものが userDir の profile.md に残る', async () => {
    await writeProfile(USER, '  朝は弱い  ')
    const file = path.join(userDir(USER), 'profile.md')
    assert.equal(await fsp.readFile(file, 'utf8'), '朝は弱い\n')
    assert.equal(await readProfile(USER), '朝は弱い\n')
  })

  it('空にすると空ファイルになる', async () => {
    await writeProfile(USER, '残さない')
    await writeProfile(USER, '  \n')
    assert.equal(await fsp.readFile(path.join(userDir(USER), 'profile.md'), 'utf8'), '')
  })
})

describe('AGENTS.md', () => {
  it('無いファイルは空文字', async () => {
    await fsp.unlink(path.join(userDir(USER), 'AGENTS.md'))
    assert.equal(await readAgents(USER), '')
  })

  it('書いたものが userDir の AGENTS.md に残る', async () => {
    await writeAgents(USER, '短く話して')
    const file = path.join(userDir(USER), 'AGENTS.md')
    assert.equal(await fsp.readFile(file, 'utf8'), '短く話して\n')
    assert.equal(await readAgents(USER), '短く話して\n')
  })

  it('雛形は実ファイルで、CLAUDE.md は置かない', async () => {
    const dir = userDir(USER)
    assert.ok((await fsp.lstat(path.join(dir, 'AGENTS.md'))).isFile())
    await assert.rejects(fsp.lstat(path.join(dir, 'CLAUDE.md')), { code: 'ENOENT' })
  })

  it('tags/ を用意する', async () => {
    assert.ok((await fsp.stat(tagsDir(USER))).isDirectory())
  })
})

describe('CLAUDE.md からの移行', () => {
  const dir = userDir(USER)

  // 以前の形。CLAUDE.md が実体で AGENTS.md はそれへのリンク。
  async function placeOldLayout(text: string): Promise<void> {
    await fsp.rm(path.join(dir, 'AGENTS.md'), { force: true })
    await fsp.writeFile(path.join(dir, 'CLAUDE.md'), text)
    await fsp.symlink('CLAUDE.md', path.join(dir, 'AGENTS.md'))
  }

  it('CLAUDE.md の中身を AGENTS.md に移し、CLAUDE.md とリンクを消す', async () => {
    await placeOldLayout('# taro\n\n短く話す\n')
    await migratePersonaFile(dir)
    assert.ok((await fsp.lstat(path.join(dir, 'AGENTS.md'))).isFile())
    assert.equal(await readAgents(USER), '# taro\n\n短く話す\n')
    await assert.rejects(fsp.lstat(path.join(dir, 'CLAUDE.md')), { code: 'ENOENT' })
  })

  it('ensureUser を通しても同じで、雛形で上書きしない', async () => {
    await placeOldLayout('育てた人格\n')
    await ensureUser(USER)
    assert.equal(await readAgents(USER), '育てた人格\n')
    await assert.rejects(fsp.lstat(path.join(dir, 'CLAUDE.md')), { code: 'ENOENT' })
  })

  it('手で置いた実ファイルの AGENTS.md は残し、CLAUDE.md は .bak に退ける', async () => {
    await fsp.writeFile(path.join(dir, 'AGENTS.md'), '手書き\n')
    await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '古い方\n')
    await migratePersonaFile(dir)
    assert.equal(await readAgents(USER), '手書き\n')
    assert.equal(await fsp.readFile(path.join(dir, 'CLAUDE.md.bak'), 'utf8'), '古い方\n')
    await assert.rejects(fsp.lstat(path.join(dir, 'CLAUDE.md')), { code: 'ENOENT' })
  })

  it('SMB 越しに見えるように両方が同じ中身の実ファイルなら、CLAUDE.md だけ消す', async () => {
    await fsp.writeFile(path.join(dir, 'AGENTS.md'), '同じ\n')
    await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '同じ\n')
    await migratePersonaFile(dir)
    assert.ok((await fsp.lstat(path.join(dir, 'AGENTS.md'))).isFile())
    assert.equal(await readAgents(USER), '同じ\n')
    await assert.rejects(fsp.lstat(path.join(dir, 'CLAUDE.md')), { code: 'ENOENT' })
    await assert.rejects(fsp.lstat(path.join(dir, 'CLAUDE.md.bak')), { code: 'ENOENT' })
  })

  it('CLAUDE.md が無ければ何もしない', async () => {
    await writeAgents(USER, 'そのまま')
    await migratePersonaFile(dir)
    assert.equal(await readAgents(USER), 'そのまま\n')
  })

  it('会話フォルダのリンクは外し、実ファイルは残す', async () => {
    const topic = await createTopic(USER, {})
    const found = await resolveTopic(USER, topic.slug)
    assert.ok(found)
    const chat = path.join(dir, 'topics', found.folder)
    const persona = await readAgents(USER)
    await fsp.symlink(path.join('..', '..', 'CLAUDE.md'), path.join(chat, 'AGENTS.md'))
    await removeChatAgentsLink(chat, persona)
    await assert.rejects(fsp.lstat(path.join(chat, 'AGENTS.md')), { code: 'ENOENT' })

    // SMB 越しではリンクが人直下と同じ中身の実ファイルに見える。それも消す。
    await fsp.writeFile(path.join(chat, 'AGENTS.md'), persona)
    await removeChatAgentsLink(chat, persona)
    await assert.rejects(fsp.lstat(path.join(chat, 'AGENTS.md')), { code: 'ENOENT' })

    await fsp.writeFile(path.join(chat, 'AGENTS.md'), 'この会話だけの指示\n')
    await removeChatAgentsLink(chat, persona)
    assert.equal(await fsp.readFile(path.join(chat, 'AGENTS.md'), 'utf8'), 'この会話だけの指示\n')
  })
})

describe('organize.md', () => {
  it('雛形を置く', async () => {
    const text = await readOrganize(USER)
    assert.match(text, /整理の方針/)
    assert.match(text, /一度きりの出来事は書かない/)
    assert.ok((await fsp.stat(organizeFile(USER))).isFile())
  })

  it('書いたものが userDir の organize.md に残る', async () => {
    await writeOrganize(USER, '  展覧会は美術館博物館巡り  ')
    assert.equal(await fsp.readFile(organizeFile(USER), 'utf8'), '展覧会は美術館博物館巡り\n')
    assert.equal(await readOrganize(USER), '展覧会は美術館博物館巡り\n')
  })

  it('会話フォルダには AGENTS.md を置かない', async () => {
    const topic = await createTopic(USER, {})
    const found = await resolveTopic(USER, topic.slug)
    assert.ok(found)
    const file = path.join(userDir(USER), 'topics', found.folder, 'AGENTS.md')
    await assert.rejects(fsp.lstat(file), { code: 'ENOENT' })
  })
})

describe('覚え書き.md', () => {
  it('無いファイルは空文字', async () => {
    assert.equal(await readMemory(USER), '')
  })

  it('日時を添えて追記する', async () => {
    const result = await appendMemory(USER, '  卵アレルギー  ')
    assert.equal(result.ok, true)
    const text = await readMemory(USER)
    assert.match(text, /## \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    assert.match(text, /卵アレルギー/)
    assert.equal(await fsp.readFile(memoryFile(USER), 'utf8'), text)
  })

  it('空は断ってファイルを作らない', async () => {
    const result = await appendMemory(USER, '  \n')
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('ok')
    assert.match(result.reason, /空/)
    assert.equal(await readMemory(USER), '')
  })

  it('上限を超える追記は書かずに断る', async () => {
    const first = await appendMemory(USER, '残す')
    assert.equal(first.ok, true)
    const huge = 'あ'.repeat(20_000)
    const result = await appendMemory(USER, huge)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('ok')
    assert.match(result.reason, /上限/)
    assert.match(await readMemory(USER), /残す/)
    assert.equal((await readMemory(USER)).includes(huge), false)
  })
})

describe('家族共有スペース', () => {
  const FAMILY = familyUser()

  beforeEach(async () => {
    await fsp.rm(userDir(FAMILY), { recursive: true, force: true })
    await ensureFamily()
  })

  it('profile.md の雛形を置く', async () => {
    const text = await readProfile(FAMILY)
    assert.match(text, /家族のプロフィール/)
    assert.match(text, /会話のたびに読み込まれる/)
  })

  it('AGENTS.md の雛形を置く', async () => {
    const text = await readAgents(FAMILY)
    assert.match(text, /家族の共有スペース/)
    assert.match(text, /秘書役/)
  })

  it('organize.md の雛形を置く', async () => {
    const text = await readOrganize(FAMILY)
    assert.match(text, /家族の整理の方針/)
  })

  it('AGENTS.md は実ファイルで、CLAUDE.md は置かない', async () => {
    assert.ok((await fsp.lstat(path.join(userDir(FAMILY), 'AGENTS.md'))).isFile())
    await assert.rejects(fsp.lstat(path.join(userDir(FAMILY), 'CLAUDE.md')), { code: 'ENOENT' })
  })
})
