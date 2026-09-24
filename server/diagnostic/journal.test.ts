import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { Journal } from './journal'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-journal-'))
}

describe('Journal', () => {
  it('開き直すと、前回までの分を読み戻す', () => {
    const dir = tempDir()
    const first = new Journal<{ n: number }>('t', 10, 1024 * 1024)
    first.open(dir)
    first.push({ n: 1 })
    first.push({ n: 2 })

    const second = new Journal<{ n: number }>('t', 10, 1024 * 1024)
    second.open(dir)
    second.push({ n: 3 })
    assert.deepEqual(second.list(), [{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  it('手元には keep 件だけ持つ', () => {
    const journal = new Journal<number>('t', 3, 1024)
    for (let n = 1; n <= 5; n++) journal.push(n)
    assert.deepEqual(journal.list(), [3, 4, 5])
  })

  it('上限を超えたら .1 に退かせ、開き直すと両方から読み戻す', () => {
    const dir = tempDir()
    const journal = new Journal<string>('t', 100, 40)
    journal.open(dir)
    // 一行は `"あいう"\n` で 12 バイト。四行目で 40 を超える。
    for (const text of ['あいう', 'かきく', 'さしす', 'たちつ']) journal.push(text)

    const lines = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n')
    assert.deepEqual(lines('t.jsonl.1'), ['"あいう"', '"かきく"', '"さしす"'])
    assert.deepEqual(lines('t.jsonl'), ['"たちつ"'])

    const reopened = new Journal<string>('t', 100, 40)
    reopened.open(dir)
    assert.deepEqual(reopened.list(), ['あいう', 'かきく', 'さしす', 'たちつ'])
  })

  it('書けない場所なら理由を返し、メモリだけで続ける', () => {
    const file = path.join(tempDir(), 'file')
    fs.writeFileSync(file, '')
    const journal = new Journal<number>('t', 3, 1024)
    assert.match(journal.open(path.join(file, 'logs')) ?? '', /t を .* に書けません/)
    journal.push(1)
    assert.deepEqual(journal.list(), [1])
    assert.equal(journal.path, null)
  })

  it('開かなければファイルは作らない', () => {
    const journal = new Journal<number>('t', 3, 1024)
    journal.push(1)
    assert.equal(journal.path, null)
  })
})
