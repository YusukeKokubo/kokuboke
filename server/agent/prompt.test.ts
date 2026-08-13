import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupSummaryPrompt, summaryPrompt } from './prompt'

describe('groupSummaryPrompt', () => {
  it('中のトピックの名前と会話を載せる', () => {
    const text = groupSummaryPrompt({
      topicName: '買い物',
      summary: '既存の覚え書き',
      children: [
        {
          name: 'コストコ',
          summary: '卵を買う',
          history: [
            {
              id: '1',
              role: 'user',
              text: '牛乳も足して',
              images: [],
              at: '2026-08-13T02:00:00.000Z',
            },
          ],
        },
      ],
    })
    assert.match(text, /既存の覚え書き/)
    assert.match(text, /<name>コストコ<\/name>/)
    assert.match(text, /卵を買う/)
    assert.match(text, /牛乳も足して/)
    assert.equal(text.includes('記憶'), false)
  })
})

describe('summaryPrompt', () => {
  it('記憶という言い方をしない', () => {
    const text = summaryPrompt({
      topicName: 'コストコ',
      summary: '卵を買う',
      groupSummary: '週一で行く',
      history: [
        {
          id: '1',
          role: 'user',
          text: '牛乳も足して',
          images: [],
          at: '2026-08-13T02:00:00.000Z',
        },
      ],
    })
    assert.match(text, /一つ上のトピックの要約/)
    assert.equal(text.includes('記憶'), false)
  })
})
