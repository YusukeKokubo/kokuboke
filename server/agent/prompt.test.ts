import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chatPrompt, organizePrompt, tagDraftPrompt, tagNote, tagPrompt, tagSystemPrompt } from './prompt'

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

describe('tagNote', () => {
  it('空なら undefined', () => {
    assert.equal(tagNote(''), undefined)
    assert.equal(tagNote('   \n'), undefined)
  })

  it('空白を畳んで 40 字まで', () => {
    assert.equal(tagNote('京都に  行く\n来週'), '京都に 行く 来週')
    assert.equal(tagNote('あ'.repeat(50)), 'あ'.repeat(40))
  })
})

describe('tagPrompt', () => {
  it('大分類だけを使い、会話名はタグにしない', () => {
    const text = tagPrompt({
      history: [],
      known: [{ name: '旅行', note: '四国へ行く', group: '旅' }, { name: '学習' }],
      topicName: '大英博物館展予習',
    })
    assert.match(text, /<known_tags>/)
    assert.match(text, /- 旅行（旅）: 四国へ行く/)
    assert.match(text, /- 学習/)
    assert.match(text, /大英博物館展予習/)
    assert.match(text, /これをタグ名にしない/)
    assert.match(text, /美術館博物館巡り/)
    assert.match(text, /大分類/)
    assert.match(tagSystemPrompt(), /大分類だけで足ります/)
    assert.match(text, /"group": "文化"/)
  })
})

describe('organizePrompt', () => {
  it('タグと会話名を載せる', () => {
    const text = organizePrompt({
      tags: [
        { name: '大英博物館展', group: '', topics: ['大英博物館展予習'] },
        { name: 'スキンケア', group: '暮らし', note: '化粧水', topics: [] },
      ],
    })
    assert.match(text, /大英博物館展（棚なし）/)
    assert.match(text, /スキンケア（暮らし）/)
    assert.match(text, /化粧水/)
    assert.match(text, /type":"merge"/)
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
