import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { ensureFamily, ensureUser, readClaude, readProfile, writeClaude, writeProfile } =
  await import('./user')
const { assertUser, familyUser, tagsDir, userDir } = await import('./paths')
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

describe('CLAUDE.md', () => {
  it('無いファイルは空文字', async () => {
    await fsp.unlink(path.join(userDir(USER), 'CLAUDE.md'))
    assert.equal(await readClaude(USER), '')
  })

  it('書いたものが userDir の CLAUDE.md に残る', async () => {
    await writeClaude(USER, '短く話して')
    const file = path.join(userDir(USER), 'CLAUDE.md')
    assert.equal(await fsp.readFile(file, 'utf8'), '短く話して\n')
    assert.equal(await readClaude(USER), '短く話して\n')
  })

  it('AGENTS.md のリンクは触らない', async () => {
    await writeClaude(USER, '差し替え')
    const link = path.join(userDir(USER), 'AGENTS.md')
    assert.ok((await fsp.lstat(link)).isSymbolicLink())
    assert.equal(await fsp.readlink(link), 'CLAUDE.md')
  })

  it('tags/ を用意する', async () => {
    assert.ok((await fsp.stat(tagsDir(USER))).isDirectory())
  })

  it('会話の AGENTS.md は人直下の CLAUDE.md を指す', async () => {
    const topic = await createTopic(USER, {})
    const found = await resolveTopic(USER, topic.slug)
    assert.ok(found)
    const link = path.join(userDir(USER), 'topics', found.folder, 'AGENTS.md')
    assert.ok((await fsp.lstat(link)).isSymbolicLink())
    assert.equal(await fsp.readlink(link), path.join('..', '..', 'CLAUDE.md'))
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

  it('CLAUDE.md の雛形を置く', async () => {
    const text = await readClaude(FAMILY)
    assert.match(text, /家族の共有スペース/)
    assert.match(text, /秘書役/)
  })

  it('AGENTS.md のリンクを張る', async () => {
    const link = path.join(userDir(FAMILY), 'AGENTS.md')
    assert.ok((await fsp.lstat(link)).isSymbolicLink())
    assert.equal(await fsp.readlink(link), 'CLAUDE.md')
  })
})
