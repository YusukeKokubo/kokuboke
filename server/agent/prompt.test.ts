import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chatPrompt,
  classifyBlock,
  organizeDraftPrompt,
  organizePrompt,
  tagDraftPrompt,
  tagNote,
  tagPrompt,
  tagSystemPrompt,
} from './prompt'

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

  it('添付ファイルのパスを載せる', () => {
    const text = chatPrompt({
      profile: '',
      tags: [],
      history: [],
      text: 'これ見て',
      imagePaths: ['/tmp/a.jpg'],
      filePaths: ['/tmp/b.pdf'],
    })
    assert.match(text, /添付（Read ツールで開いてください）/)
    assert.match(text, /\/tmp\/a\.jpg（画像）/)
    assert.match(text, /\/tmp\/b\.pdf（ファイル）/)
  })

  it('履歴のファイル添付も書く', () => {
    const text = chatPrompt({
      profile: '',
      tags: [],
      history: [
        {
          id: '1',
          role: 'user',
          text: '資料',
          images: [],
          files: ['a.pdf'],
          at: '2026-08-23T02:00:00.000Z',
        },
      ],
      text: '続き',
      imagePaths: [],
    })
    assert.match(text, /ファイル 1/)
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

  it('手直しログは載せない', () => {
    const text = chatPrompt({
      profile: '朝は弱い',
      tags: [],
      history: [],
      text: 'おはよう',
      imagePaths: [],
    })
    assert.equal(text.includes('<revisions>'), false)
    assert.equal(text.includes('<organize_policy>'), false)
  })
})

describe('classifyBlock', () => {
  it('手直しと方針を載せる', () => {
    const text = classifyBlock({
      revisions: [{ at: '2026-08-23T00:00:00.000Z', kind: 'name', from: '旧', to: '新' }],
      policy: '展覧会は美術館博物館巡り',
    })
    assert.match(text, /<revisions>/)
    assert.match(text, /「旧」→「新」/)
    assert.match(text, /<organize_policy>/)
    assert.match(text, /美術館博物館巡り/)
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
    assert.equal(text.includes('<revisions>'), false)
  })

  it('手直しログと方針を載せる', () => {
    const text = tagPrompt({
      history: [],
      known: [],
      revisions: [
        { at: '2026-08-23T00:00:00.000Z', kind: 'tag', from: ['大英博物館展'], to: ['美術館博物館巡り'] },
      ],
      policy: '展覧会は美術館博物館巡り',
    })
    assert.match(text, /<revisions>/)
    assert.match(text, /大英博物館展/)
    assert.match(text, /<organize_policy>/)
    assert.match(text, /展覧会は美術館博物館巡り/)
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

  it('手直しログを載せる', () => {
    const text = organizePrompt({
      tags: [{ name: '旅行', group: '旅', topics: [] }],
      revisions: [
        {
          at: '2026-08-23T00:00:00.000Z',
          kind: 'organize',
          accepted: [{ type: 'merge', from: '大英博物館展', to: '美術館博物館巡り' }],
          rejected: [],
        },
      ],
    })
    assert.match(text, /<revisions>/)
    assert.match(text, /大英博物館展/)
  })
})

describe('organizeDraftPrompt', () => {
  it('今の方針と手直しを載せる', () => {
    const text = organizeDraftPrompt({
      current: '展覧会は美術館博物館巡り',
      revisions: [{ at: '2026-08-23T00:00:00.000Z', kind: 'name', from: '旧', to: '新' }],
      tags: [{ name: '旅行', group: '旅' }],
    })
    assert.match(text, /展覧会は美術館博物館巡り/)
    assert.match(text, /<revisions>/)
    assert.match(text, /旅行（旅）/)
    assert.match(text, /一回の例外は規則にしない/)
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
              files: [],
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
