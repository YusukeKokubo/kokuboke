import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diaryAnswerText } from '../../shared/diary-form'
import { parseQuestion, PLAIN_QUESTION } from './question'

describe('parseQuestion', () => {
  it('本文と各欄の候補を読む', () => {
    const { text, form } = parseQuestion(
      JSON.stringify({
        text: '新型が出たってニュースになっとったよ。',
        choices: { where: ['家', 'スーパー'], who: ['ひとり'], what: ['晩ごはんの支度'], mood: ['ふつう'] },
      }),
    )
    assert.equal(text, '新型が出たってニュースになっとったよ。')
    assert.deepEqual(
      form.fields.map((field) => [field.label, field.choices]),
      [
        ['どこで', ['家', 'スーパー']],
        ['だれと', ['ひとり']],
        ['なにを', ['晩ごはんの支度']],
        ['きぶん', ['ふつう']],
      ],
    )
  })

  it('長すぎる・重なった・「ほか」の候補は捨て、空いた欄は決まった候補で埋める', () => {
    const { form } = parseQuestion(
      JSON.stringify({
        text: 'どう？',
        choices: { where: ['家', '家', 'ほか', 'あ'.repeat(30), '駅', '公園', '図書館', '海'], who: 'ひとり' },
      }),
    )
    assert.deepEqual(form.fields[0]!.choices, ['家', '駅', '公園', '図書館'])
    assert.deepEqual(form.fields[1]!.choices, ['ひとり', '家族と', '友だちと', '職場の人と'])
  })

  it('JSON で返らなければ丸ごと本文にする', () => {
    const { text, form } = parseQuestion('紅葉が始まったね。どう？')
    assert.equal(text, '紅葉が始まったね。どう？')
    assert.equal(form.fields.length, 4)
    assert.equal(parseQuestion('').text, PLAIN_QUESTION)
  })
})

describe('diaryAnswerText', () => {
  it('埋めた欄だけを一行ずつにし、ひとことを最後に添える', () => {
    const form = parseQuestion('').form
    assert.equal(
      diaryAnswerText(form, ['家', '', ' ひと休み ', 'ふつう'], '洗濯物干してから一息'),
      'どこで: 家\nなにを: ひと休み\nきぶん: ふつう\n洗濯物干してから一息',
    )
  })
})
