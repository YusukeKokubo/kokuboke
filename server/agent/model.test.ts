import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.USERS = 'taro'
process.env.CLAUDE_MODEL = 'claude-sonnet-5-5'
process.env.CLAUDE_LIGHT_MODEL = 'claude-haiku-5-5'

const { lightModel, resolveModel } = await import('./model')

describe('lightModel', () => {
  it('エンジンはそのままで、モデルだけ軽いものにする', () => {
    assert.deepEqual(lightModel('claude'), {
      engine: 'claude',
      model: 'claude-haiku-5-5',
      effort: null,
      label: 'Claude Code / Haiku 5.5',
    })
  })

  it('エンジンの指定が無ければ既定のエンジンで選ぶ', () => {
    assert.deepEqual(lightModel(undefined), lightModel('claude'))
    assert.deepEqual(lightModel('unknown'), lightModel('claude'))
  })
})

describe('resolveModel', () => {
  it('消したエンジンのトピックは既定のエンジンとモデルに落ちる', () => {
    // cursor で作ったトピックが data に残っている。
    const choice = resolveModel('cursor', 'composer-2.5')
    assert.equal(choice.engine, 'claude')
    assert.equal(choice.model, 'claude-sonnet-5-5')
  })
})

describe('resolveModel の考える深さ', () => {
  it('選べるモデルは深さを持つ', () => {
    assert.equal(resolveModel('claude', 'claude-opus-5-5', 'xhigh').effort, 'xhigh')
    assert.equal(resolveModel('claude', 'claude-haiku-5-5', 'xhigh').effort, 'xhigh')
  })

  it('知らないモデルで既定に落ちたときも、既定が選べるなら深さを残す', () => {
    assert.equal(resolveModel('claude', 'claude-unknown', 'medium').effort, 'medium')
  })
})
