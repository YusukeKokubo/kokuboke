import fs from 'node:fs/promises'
import { Hono } from 'hono'
import { BadRequestError, NotFoundError } from '../errors'
import { imageAbsPath } from '../store/image'
import { assertInsideDataDir, assertTopicRef, assertUser } from '../store/paths'

export const media = new Hono()

/** 保存済みの画像を返す。データディレクトリの外は絶対に読ませない。 */
media.on('GET', ['/media/:user/:topic/:file', '/media/:user/:topic/sub/:sub/:file'], async (c) => {
  const user = assertUser(c.req.param('user'))
  const ref = assertTopicRef(c.req.param('topic'), c.req.param('sub'))

  const target = imageAbsPath(user, ref, c.req.param('file'))
  if (!target) {
    throw new BadRequestError('ファイル名が不正です')
  }
  assertInsideDataDir(target)

  let body: Buffer
  try {
    body = await fs.readFile(target)
  } catch {
    throw new NotFoundError('画像が見つかりません')
  }

  return c.body(new Uint8Array(body), 200, {
    'Content-Type': 'image/jpeg',
    // 同じファイル名が再利用されることはないので長く持たせてよい。
    'Cache-Control': 'private, max-age=31536000, immutable',
  })
})
