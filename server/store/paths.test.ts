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

const { assertInsideDataDir, assertTopicName, assertUser, isGroupRef, isTopicName, normalizeTopicName, toTopicName } =
  await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

describe('isTopicName', () => {
  it('日本語も英数字も通す', () => {
    assert.ok(isTopicName('算数の宿題'))
    assert.ok(isTopicName('math'))
    assert.ok(isTopicName('宿題 2026'))
    assert.ok(isTopicName('ドラえもん'), '濁点つきも通る')
  })

  it('パスの区切りになるものを弾く', () => {
    assert.ok(!isTopicName('../secret'))
    assert.ok(!isTopicName('a/b'))
    assert.ok(!isTopicName('a\\b'))
    assert.ok(!isTopicName('..'))
    assert.ok(!isTopicName('.'))
  })

  it('SMB で扱えない文字を弾く', () => {
    for (const bad of ['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      assert.ok(!isTopicName(bad), `${bad} を通してはいけない`)
    }
  })

  it('制御文字を弾く', () => {
    assert.ok(!isTopicName('a\u0000b'))
    assert.ok(!isTopicName('a\nb'))
    assert.ok(!isTopicName('a\u007fb'))
  })

  it('隠しファイルになる名前と末尾のドットを弾く', () => {
    assert.ok(!isTopicName('.hidden'))
    assert.ok(!isTopicName('name.'))
  })

  it('空の名前を弾く', () => {
    assert.ok(!isTopicName(''))
    assert.ok(!isTopicName('   '))
  })

  it('ファイル名の上限を超える長さを弾く', () => {
    assert.ok(isTopicName('あ'.repeat(60)), '180 バイトまでは通る')
    assert.ok(!isTopicName('あ'.repeat(61)), '180 バイトを超えたら弾く')
  })

  it('繰り返し呼んでも結果が変わらない', () => {
    // global な正規表現を test() に使うと lastIndex が残って交互に落ちる。
    for (let i = 0; i < 4; i++) {
      assert.ok(!isTopicName('a/b'), `${i} 回目で結果が変わった`)
      assert.ok(isTopicName('算数'), `${i} 回目で結果が変わった`)
    }
  })
})

describe('normalizeTopicName', () => {
  it('分かれた濁点を合成済みの形に寄せる', () => {
    const nfd = 'ドラえもん'.normalize('NFD')
    assert.notEqual(nfd, 'ドラえもん')
    assert.equal(normalizeTopicName(nfd), 'ドラえもん')
  })

  it('前後の空白を落とす', () => {
    assert.equal(normalizeTopicName('  算数  '), '算数')
  })
})

describe('toTopicName', () => {
  it('使える名前はそのまま通す', () => {
    assert.equal(toTopicName('算数の宿題'), '算数の宿題')
    assert.equal(toTopicName('  Math Homework  '), 'Math Homework')
  })

  it('使えない文字を落とす', () => {
    assert.equal(toTopicName('算数/宿題'), '算数 宿題')
    assert.equal(toTopicName('.hidden'), 'hidden')
    assert.equal(toTopicName('name.'), 'name')
  })

  it('落とすと何も残らない名前だけ機械的な名前にする', () => {
    assert.match(toTopicName('///'), /^t-[0-9a-f]{8}$/)
    assert.match(toTopicName('   '), /^t-[0-9a-f]{8}$/)
  })

  it('作った名前は必ず isTopicName を満たす', () => {
    for (const input of ['///', '...', 'あ'.repeat(200), 'a:b*c?d', '\u0000']) {
      assert.ok(isTopicName(toTopicName(input)), `${JSON.stringify(input)} の結果が不正`)
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

describe('assertTopicName', () => {
  it('日本語は通す', () => {
    assert.equal(assertTopicName('算数の宿題'), '算数の宿題')
  })

  it('URL から届く分かれた濁点を合成済みに揃える', () => {
    assert.equal(assertTopicName('ドラえもん'.normalize('NFD')), 'ドラえもん')
  })

  it('使えない名前は 400', () => {
    assert.throws(() => assertTopicName('../secret'), { status: 400 })
    assert.throws(() => assertTopicName('a/b'), { status: 400 })
    assert.throws(() => assertTopicName(''), { status: 400 })
  })
})

describe('isGroupRef', () => {
  it('sub が無ければ器', () => {
    assert.equal(isGroupRef({ topic: 'スキンケア' }), true)
  })

  it('sub があれば子', () => {
    assert.equal(isGroupRef({ topic: 'スキンケア', sub: '肌の記録' }), false)
  })

  it('空文字の sub は子の途中状態で、器にはしない', () => {
    assert.equal(isGroupRef({ topic: 'スキンケア', sub: '' }), false)
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
