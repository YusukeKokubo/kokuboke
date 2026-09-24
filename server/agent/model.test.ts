import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.USERS = 'taro'
process.env.DEFAULT_ENGINE = 'cursor'
process.env.CLAUDE_LIGHT_MODEL = 'claude-haiku-4-5'
process.env.CURSOR_LIGHT_MODEL = 'composer-2.5'

const { lightModel } = await import('./model')

describe('lightModel', () => {
  it('エンジンはそのままで、モデルだけ軽いものにする', () => {
    assert.deepEqual(lightModel('claude'), {
      engine: 'claude',
      model: 'claude-haiku-4-5',
      label: 'Claude Code / Haiku 4.5',
    })
    assert.equal(lightModel('cursor').model, 'composer-2.5')
  })

  it('エンジンの指定が無ければ既定のエンジンで選ぶ', () => {
    assert.deepEqual(lightModel(undefined), lightModel('cursor'))
    assert.deepEqual(lightModel('unknown'), lightModel('cursor'))
  })
})
