import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chatPrompt, tagDraftPrompt } from './prompt'

describe('chatPrompt', () => {
  it('付いているタグの本文を載せる', () => {
    const text = chatPrompt({
      profile: '',
      tags: [{ name: '秋の旅行', text: '京都に行く' }],
      history: [],
      text: 'ホテルは？',
      imagePaths: [],
    })
    assert.match(text, /<tag name="秋の旅行">/)
    assert.match(text, /京都に行く/)
  })

  it('空のタグ本文は載せない', () => {
    const text = chatPrompt({
      profile: '',
      tags: [{ name: '買い物', text: '  ' }],
      history: [],
      text: '牛乳',
      imagePaths: [],
    })
    assert.equal(text.includes('<tag'), false)
  })
})

describe('tagDraftPrompt', () => {
  it('タグ名と会話を載せる', () => {
    const text = tagDraftPrompt({
      tagName: '買い物',
      current: '既存の覚え書き',
      chats: [
        {
          name: 'コストコ',
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
    assert.match(text, /牛乳も足して/)
    assert.equal(text.includes('記憶'), false)
  })
})
