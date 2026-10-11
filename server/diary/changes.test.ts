import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { applyProfileChanges, charCount, parseProfileChanges } = await import('./changes')

const PROFILE = '# taro\n\n- 会社員\n- 朝はコーヒー\n'
const KNOWN = new Set(['2026-10-05', '2026-10-07', '2026-10-09'])

function raw(changes: unknown[]): string {
  return `前置き\n${JSON.stringify({ changes })}\n`
}

describe('parseProfileChanges', () => {
  it('当てられる案だけ残し、通し番号を振る', () => {
    const changes = parseProfileChanges(
      raw([
        { type: 'add', text: '- 週末は子どもとホームセンター', dates: ['2026-10-05', '2026-10-09'] },
        { type: 'replace', from: '- 朝はコーヒー', to: '- 朝は紅茶', dates: ['2026-10-05', '2026-10-07'] },
        { type: 'remove', text: '- 会社員', reason: '転職したと話していた' },
      ]),
      PROFILE,
      KNOWN,
    )
    assert.deepEqual(
      changes.map((change) => [change.id, change.type]),
      [
        ['c1', 'add'],
        ['c2', 'replace'],
        ['c3', 'remove'],
      ],
    )
  })

  it('根拠が一日分しかない案は捨てる', () => {
    const changes = parseProfileChanges(
      raw([
        { type: 'add', text: '- 風邪気味', dates: ['2026-10-05'] },
        { type: 'add', text: '- 同じ日を二回', dates: ['2026-10-05', '2026-10-05'] },
        { type: 'add', text: '- 渡していない日', dates: ['2026-10-05', '2026-09-01'] },
      ]),
      PROFILE,
      KNOWN,
    )
    assert.deepEqual(changes, [])
  })

  it('元の行が無い直し・消し、すでにある行の足しは捨てる', () => {
    const changes = parseProfileChanges(
      raw([
        { type: 'replace', from: '- 夜は早寝', to: '- 夜は遅い', dates: ['2026-10-05', '2026-10-07'] },
        { type: 'remove', text: '- 無い行', reason: '古い' },
        { type: 'add', text: '- 会社員', dates: ['2026-10-05', '2026-10-07'] },
      ]),
      PROFILE,
      KNOWN,
    )
    assert.deepEqual(changes, [])
  })

  it('同じ行を二つの案で触らせない', () => {
    const changes = parseProfileChanges(
      raw([
        { type: 'replace', from: '- 会社員', to: '- 自営業', dates: ['2026-10-05', '2026-10-07'] },
        { type: 'remove', text: '- 会社員', reason: '古い' },
      ]),
      PROFILE,
      KNOWN,
    )
    assert.equal(changes.length, 1)
  })

  it('JSON が読めなければ空', () => {
    assert.deepEqual(parseProfileChanges('ごめんなさい', PROFILE, KNOWN), [])
  })
})

describe('applyProfileChanges', () => {
  it('直す・消すは元の位置で、足すは末尾', () => {
    const next = applyProfileChanges(PROFILE, [
      { id: 'c1', type: 'add', text: '- 週末はホームセンター', dates: [] },
      { id: 'c2', type: 'replace', from: '- 朝はコーヒー', to: '- 朝は紅茶', dates: [] },
      { id: 'c3', type: 'remove', text: '- 会社員', reason: '' },
    ])
    assert.equal(next, '# taro\n\n- 朝は紅茶\n- 週末はホームセンター\n')
  })

  it('人が手で直して元の行が無くなった案は飛ばす', () => {
    const next = applyProfileChanges(PROFILE, [
      { id: 'c1', type: 'remove', text: '- もう無い行', reason: '' },
    ])
    assert.equal(next, PROFILE)
  })
})

describe('charCount', () => {
  it('絵文字も一字に数える', () => {
    assert.equal(charCount(' 朝☕️ '), 2)
    assert.equal(charCount('🍵'), 1)
  })
})
