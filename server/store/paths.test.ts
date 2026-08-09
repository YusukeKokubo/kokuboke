import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

// config は読み込んだ時点で環境変数を見るので、import より先に差し込む。
// process.loadEnvFile は既にある値を上書きしないため、リポジトリの .env には負けない。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro,hanako'

const { assertInsideDataDir, assertTopicSlug, assertUser, isSlug, toSlug } = await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

describe('isSlug', () => {
  it('英数字とハイフンだけを通す', () => {
    assert.ok(isSlug('math'))
    assert.ok(isSlug('math-2026'))
    assert.ok(!isSlug('Math'), '大文字は通さない')
    assert.ok(!isSlug('-math'), '先頭のハイフンは通さない')
    assert.ok(!isSlug('math-'), '末尾のハイフンは通さない')
    assert.ok(!isSlug('数学'), '日本語は通さない')
    assert.ok(!isSlug(''))
  })

  it('パスの区切りや上位への参照を通さない', () => {
    assert.ok(!isSlug('../etc'))
    assert.ok(!isSlug('a/b'))
    assert.ok(!isSlug('..'))
  })
})

describe('toSlug', () => {
  it('英数字が残る名前はそのまま識別子にする', () => {
    assert.equal(toSlug('Math Homework'), 'math-homework')
    assert.equal(toSlug('  trim me  '), 'trim-me')
  })

  it('日本語だけの名前は乱数に落とす', () => {
    const slug = toSlug('算数の宿題')
    assert.match(slug, /^t-[0-9a-f]{8}$/)
    assert.ok(isSlug(slug), '落とした先も識別子として通る')
  })

  it('作った識別子は必ず isSlug を満たす', () => {
    for (const name of ['---', '2026', 'a'.repeat(80), '!!!', 'ｶﾀｶﾅ']) {
      assert.ok(isSlug(toSlug(name)), `${name} から作った識別子が不正`)
    }
  })
})

describe('assertUser', () => {
  it('USERS にある名前は通す', () => {
    assert.equal(assertUser('taro'), 'taro')
  })

  it('USERS に無い名前は 404', () => {
    assert.throws(() => assertUser('unknown'), { status: 404 })
  })
})

describe('assertTopicSlug', () => {
  it('識別子でないものは 400', () => {
    assert.throws(() => assertTopicSlug('../secret'), { status: 400 })
    assert.throws(() => assertTopicSlug('日本語'), { status: 400 })
  })
})

describe('assertInsideDataDir', () => {
  it('データディレクトリの中は通す', () => {
    assert.equal(assertInsideDataDir(path.join(dataDir, 'taro')), path.join(dataDir, 'taro'))
  })

  it('外へ出るパスは弾く', () => {
    assert.throws(() => assertInsideDataDir(path.join(dataDir, '..', 'etc')), { status: 400 })
    assert.throws(() => assertInsideDataDir('/etc/passwd'), { status: 400 })
  })

  it('先頭が一致するだけの隣のディレクトリは弾く', () => {
    assert.throws(() => assertInsideDataDir(`${dataDir}-evil`), { status: 400 })
  })
})
