import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { claudeActivity, cursorActivity } from './activity'

describe('cursorActivity', () => {
  it('道具の名前は tool_call のキーから拾う', () => {
    // 実際の行には toolCallId や startedAtMs も同じ器に入っている。
    assert.equal(
      cursorActivity({ readToolCall: { args: {} }, toolCallId: 'x', startedAtMs: '1' }),
      'ファイルを見ています',
    )
    assert.equal(cursorActivity({ grepToolCall: {} }), '書いたものを探しています')
    assert.equal(cursorActivity({ globToolCall: {} }), '書いたものを探しています')
    assert.equal(cursorActivity({ webSearchToolCall: {} }), 'ウェブで調べています')
    assert.equal(cursorActivity({ webFetchToolCall: {} }), 'ページを読んでいます')
  })

  it('知らない道具は丸めて出す', () => {
    assert.equal(cursorActivity({ somethingNewToolCall: {} }), '調べています')
  })

  it('道具の名前が見つからなければ何も出さない', () => {
    assert.equal(cursorActivity({ toolCallId: 'x' }), null)
    assert.equal(cursorActivity({}), null)
  })
})

describe('claudeActivity', () => {
  it('tool_use の name から選ぶ', () => {
    assert.equal(claudeActivity('Read'), 'ファイルを見ています')
    assert.equal(claudeActivity('Grep'), '書いたものを探しています')
  })

  it('知らない道具と名無しは丸めて出す', () => {
    assert.equal(claudeActivity('Bash'), '調べています')
    assert.equal(claudeActivity(''), '調べています')
  })
})
