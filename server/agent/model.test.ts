import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.USERS = 'taro'
process.env.DEFAULT_ENGINE = 'cursor'
process.env.CLAUDE_LIGHT_MODEL = 'claude-haiku-4-5'
process.env.CURSOR_LIGHT_MODEL = 'composer-2.5'

const { lightModel, resolveModel } = await import('./model')

describe('lightModel', () => {
  it('エンジンはそのままで、モデルだけ軽いものにする', () => {
    assert.deepEqual(lightModel('claude'), {
      engine: 'claude',
      model: 'claude-haiku-4-5',
      effort: null,
      label: 'Claude Code / Haiku 4.5',
    })
    assert.equal(lightModel('cursor').model, 'composer-2.5')
  })

  it('エンジンの指定が無ければ既定のエンジンで選ぶ', () => {
    assert.deepEqual(lightModel(undefined), lightModel('cursor'))
    assert.deepEqual(lightModel('unknown'), lightModel('cursor'))
  })
})

describe('resolveModel の考える深さ', () => {
  it('選べるモデルだけが深さを持つ', () => {
    assert.equal(resolveModel('claude', 'claude-opus-5', 'xhigh').effort, 'xhigh')
    assert.equal(resolveModel('claude', 'claude-haiku-4-5', 'xhigh').effort, null)
    assert.equal(resolveModel('cursor', 'auto', 'xhigh').effort, null)
  })

  it('知らないモデルで既定に落ちたときも、既定が選べるなら深さを残す', () => {
    // CLAUDE_MODEL の既定は Opus 5。
    assert.equal(resolveModel('claude', 'claude-unknown', 'medium').effort, 'medium')
  })
})
