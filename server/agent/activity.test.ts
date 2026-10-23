import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { claudeActivity } from './activity'

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
