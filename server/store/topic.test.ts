import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { readClaude, writeClaude } = await import('./topic')
const { topicDir } = await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = 'taro'
const REF = { topic: 'math' }

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
    const child = { topic: 'math', sub: '分数' }
    await fsp.mkdir(topicDir(USER, child), { recursive: true })
    await writeClaude(USER, child, '途中式を見る')
    assert.equal(await readClaude(USER, child), '途中式を見る\n')
    assert.equal(await readClaude(USER, REF), '')
  })
})
