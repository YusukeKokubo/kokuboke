import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

// config は読み込んだ時点で環境変数を見るので、import より先に差し込む。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { unfence } = await import('./collect')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

describe('unfence', () => {
  it('中身が丸ごと囲まれていたら剥がす', () => {
    assert.equal(unfence('```markdown\n# 見出し\n本文\n```'), '# 見出し\n本文')
    assert.equal(unfence('```\n本文\n```'), '本文')
  })

  it('囲まれていなければそのまま返す', () => {
    assert.equal(unfence('# 見出し\n本文'), '# 見出し\n本文')
  })

  it('前後の空白は落とす', () => {
    assert.equal(unfence('\n\n本文\n\n'), '本文')
  })

  it('本文の一部としてのコードブロックは残す', () => {
    const text = '# 覚え書き\n\n```js\nconst a = 1\n```\n\n続き'
    assert.equal(unfence(text), text)
  })

  it('囲みの中にコードブロックがある場合は触らない', () => {
    // 剥がすと中身の対応が崩れるので、判断できないものは触らない方に倒す。
    const text = '```markdown\n本文\n\n```js\nconst a = 1\n```\n```'
    assert.equal(unfence(text), text)
  })

  it('空なら空', () => {
    assert.equal(unfence(''), '')
    assert.equal(unfence('   \n  '), '')
  })
})
