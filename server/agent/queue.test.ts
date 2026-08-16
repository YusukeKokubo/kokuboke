import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HTTPException } from 'hono/http-exception'

process.env.USERS = process.env.USERS || 'taro'

const { Limiter } = await import('./queue')

describe('Limiter.acquireWhenFree', () => {
  it('先客が居るあいだ待ち、空いたら枠を取る', async () => {
    const limiter = new Limiter(1)
    const first = await limiter.acquire('u')
    let got = false
    const waiting = limiter.acquireWhenFree('u').then((release) => {
      got = true
      release()
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(got, false)
    first()
    await waiting
    assert.equal(got, true)
  })

  it('acquire は先客が居ると 409', async () => {
    const limiter = new Limiter(1)
    const first = await limiter.acquire('u')
    await assert.rejects(() => limiter.acquire('u'), (error: unknown) => {
      assert.ok(error instanceof HTTPException)
      assert.equal(error.status, 409)
      return true
    })
    first()
  })
})
