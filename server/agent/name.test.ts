import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'

const { parseName } = await import('./name')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

describe('parseName', () => {
  it('JSON 形式の返事から名前と絵文字を取る', () => {
    assert.deepEqual(parseName('{"name":"夕食の相談","emoji":"🍚"}'), {
      name: '夕食の相談',
      emoji: '🍚',
    })
  })

  it('前置きやコードブロックが混じっても JSON を拾う', () => {
    const raw = ['提案はこれです。', '```json', '{"name":"週末の予定","emoji":"🗓️"}', '```'].join('\n')
    assert.deepEqual(parseName(raw), { name: '週末の予定', emoji: '🗓' })
  })

  it('JSON でなければ最初の行を名前として使う', () => {
    assert.deepEqual(parseName('  買い物メモ  \n理由: 毎日の記録です'), {
      name: '買い物メモ',
      emoji: undefined,
    })
  })

  it('絵文字が判断できない形なら絵文字を捨てる', () => {
    assert.deepEqual(parseName('{"name":"肌の記録","emoji":"(sparkle)"}'), {
      name: '肌の記録',
      emoji: undefined,
    })
  })

  it('名前を取り出せなければ null を返す', () => {
    assert.equal(parseName('```json\n{}\n```'), null)
  })

  it('本文に中括弧が混じっていても最初の行から名前を拾う', () => {
    assert.deepEqual(parseName('夕食の相談\n{"emoji": "🍚"}'), {
      name: '夕食の相談',
      emoji: '🍚',
    })
    assert.deepEqual(parseName('散歩の記録\n\n理由: 迷ったので {"note": "散歩"} にしました'), {
      name: '散歩の記録',
      emoji: undefined,
    })
  })

  it('拾った行が JSON そのものなら名前にしない', () => {
    assert.equal(parseName('{}'), null)
    assert.equal(parseName('{"emoji":"🍚"}'), null)
  })

  it('整形された JSON で name が無いとき、一行目の { を名前にしない', () => {
    assert.equal(parseName('{\n  "emoji": "🍚"\n}'), null)
  })

  it('行の途中に中括弧が混じっているだけなら名前として残す', () => {
    assert.equal(parseName('集合 {1,2} の話')?.name, '集合 {1,2} の話')
    assert.equal(parseName('テンプレート {name} の使い方')?.name, 'テンプレート {name} の使い方')
    assert.equal(parseName('数学の {} について')?.name, '数学の {} について')
  })

  it('分かれた濁点を合成済みの形に寄せる', () => {
    assert.equal(parseName('か\u3099っこうの記録')?.name, 'がっこうの記録')
  })

  it('40 文字で切る', () => {
    assert.equal(parseName('あ'.repeat(50))?.name, 'あ'.repeat(40))
  })

  it('先頭と末尾の飾りを剥がす', () => {
    assert.equal(parseName('「夕食の相談」')?.name, '夕食の相談')
    assert.equal(parseName('- "夕食の相談"')?.name, '夕食の相談')
    assert.equal(parseName('* 『夕食の相談』')?.name, '夕食の相談')
  })

  it('絵文字が複数来たら一文字目だけ取る', () => {
    assert.equal(parseName('{"name":"旅行の計画","emoji":"🍚🍜🍣"}')?.emoji, '🍚')
  })
})
