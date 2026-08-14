import fs from 'node:fs/promises'
import { Hono } from 'hono'
import { BadRequestError, NotFoundError } from '../errors'
import { imageAbsPath } from '../store/image'
import { assertInsideDataDir, assertTopicRef, familyUser } from '../store/paths'

export const familyMedia = new Hono()

/** 家族共有スペースの保存済み画像を返す。データディレクトリの外は絶対に読ませない。 */
familyMedia.on('GET', ['/media/family/:topic/:file', '/media/family/:topic/sub/:sub/:file'], async (c) => {
  const user = familyUser()
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
