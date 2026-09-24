import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyDiff, lineDiff, splitConsult } from '../../shared/tag-consult'

// 画面が使う関数だが、テストはここにしか置けないので、案を返すエンジンの隣に置く。

describe('splitConsult', () => {
  it('返事と本文の案に分ける', () => {
    const raw = 'こう直すね。\n<proposal>\n# 旅行\n- 子連れ前提\n</proposal>'
    assert.deepEqual(splitConsult(raw), {
      reply: 'こう直すね。',
      proposal: '# 旅行\n- 子連れ前提',
      writing: false,
    })
  })

  it('案が無ければ返事だけ', () => {
    assert.deepEqual(splitConsult('どっちにする？'), {
      reply: 'どっちにする？',
      proposal: null,
      writing: false,
    })
  })

  it('流している途中は、閉じるまで書いている扱い', () => {
    assert.deepEqual(splitConsult('こう直すね。\n<proposal>\n# 旅'), {
      reply: 'こう直すね。',
      proposal: null,
      writing: true,
    })
  })

  it('開きタグの書きかけは返事に出さない', () => {
    assert.equal(splitConsult('こう直すね。\n<propo').reply, 'こう直すね。')
  })

  it('案の中のコードブロックの囲みを外す', () => {
    const raw = '<proposal>\n```markdown\n- 一行目\n```\n</proposal>'
    assert.equal(splitConsult(raw).proposal, '- 一行目')
  })
})

describe('lineDiff / applyDiff', () => {
  const before = '# 旅行\n\n- 候補は3つまで\n- 旅程は朝昼夜で区切る\n'
  const after = '# 旅行\n\n- 候補は3つまで\n- 旅程は朝昼夜で区切り、昼寝を空ける\n- 子連れ前提\n'

  it('変わった所を塊にまとめる', () => {
    const changes = lineDiff(before, after).filter((segment) => segment.kind === 'change')
    assert.deepEqual(changes, [
      {
        kind: 'change',
        id: 0,
        removed: ['- 旅程は朝昼夜で区切る'],
        added: ['- 旅程は朝昼夜で区切り、昼寝を空ける', '- 子連れ前提'],
      },
    ])
  })

  it('足すだけの行は一行ずつ選べる', () => {
    const segments = lineDiff('- a\n', '- a\n- b\n- c\n')
    const changes = segments.filter((segment) => segment.kind === 'change')
    assert.equal(changes.length, 2)
    assert.equal(applyDiff(segments, new Set([changes[1]!.id])), '- a\n- c\n')
  })

  it('全部選べば案そのもの、何も選ばなければ元のまま', () => {
    const segments = lineDiff(before, after)
    assert.equal(applyDiff(segments, new Set([0])), after)
    assert.equal(applyDiff(segments, new Set()), before)
  })

  it('選んだ塊だけ入れる', () => {
    const segments = lineDiff('- a\n- b\n- c\n', '- A\n- b\n- c\n- d\n')
    const ids = segments.flatMap((segment) => (segment.kind === 'change' ? [segment.id] : []))
    assert.equal(ids.length, 2)
    assert.equal(applyDiff(segments, new Set([ids[1]!])), '- a\n- b\n- c\n- d\n')
  })

  it('空の本文から書き起こす', () => {
    const segments = lineDiff('', '- 一行目\n')
    assert.equal(applyDiff(segments, new Set([0])), '- 一行目\n')
  })

  it('同じなら直しは無い', () => {
    assert.equal(
      lineDiff(before, before.trimEnd()).some((segment) => segment.kind === 'change'),
      false,
    )
  })
})
