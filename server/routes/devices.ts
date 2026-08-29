import { Hono } from 'hono'
import { readJson } from '../lib/body'
import { addDevice, assertDeviceToken, removeDevice } from '../store/device'
import { assertUser } from '../store/paths'

/**
 * 端末の FCM トークン。人に紐づくので共有スペースの経路は持たない。
 * 家族の会話で飛ばす先も、発言した本人のここ。
 */
export const devices = new Hono()

devices.post('/api/users/:user/devices', async (c) => {
  const user = assertUser(c.req.param('user') ?? '')
  const body = await readJson<{ token?: unknown }>(c.req.raw)
  const token = assertDeviceToken(body.token)
  await addDevice(user, token)
  return c.body(null, 204)
})

devices.delete('/api/users/:user/devices', async (c) => {
  const user = assertUser(c.req.param('user') ?? '')
  const body = await readJson<{ token?: unknown }>(c.req.raw)
  const token = assertDeviceToken(body.token)
  await removeDevice(user, token)
  return c.body(null, 204)
})
