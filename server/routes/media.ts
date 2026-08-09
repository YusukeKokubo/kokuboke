import fs from 'node:fs/promises'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { imageAbsPath } from '../store/image'
import { assertInsideDataDir, assertTopicName, assertUser } from '../store/paths'

export const media = new Hono()

/** 保存済みの画像を返す。データディレクトリの外は絶対に読ませない。 */
media.get('/media/:user/:topic/:file', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicName(c.req.param('topic'))

  const target = imageAbsPath(user, topic, c.req.param('file'))
  if (!target) {
    throw new HTTPException(400, { message: 'ファイル名が不正です' })
  }
  assertInsideDataDir(target)

  let body: Buffer
  try {
    body = await fs.readFile(target)
  } catch {
    throw new HTTPException(404, { message: '画像が見つかりません' })
  }

  return c.body(new Uint8Array(body), 200, {
    'Content-Type': 'image/jpeg',
    // 同じファイル名が再利用されることはないので長く持たせてよい。
    'Cache-Control': 'private, max-age=31536000, immutable',
  })
})
