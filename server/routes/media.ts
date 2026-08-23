import fs from 'node:fs/promises'
import { Hono } from 'hono'
import { BadRequestError, NotFoundError } from '../errors'
import { fileAbsPath, fileContentType } from '../store/file'
import { imageAbsPath } from '../store/image'
import { assertInsideDataDir } from '../store/paths'
import { resolveTopic } from '../store/topic'
import { resolveMediaSpace } from './space'

export const media = new Hono()

/**
 * 保存済みの画像と添付ファイルを返す。データディレクトリの外は絶対に読ませない。
 * 名前の位置には個人ならユーザー名、共有スペースなら `family` が入る。
 * 会話は uuid、またはフォルダ名で指す。
 */
media.get('/media/:user/:topic/:file', async (c) => {
  const { user } = resolveMediaSpace(c)
  const found = await resolveTopic(user, c.req.param('topic') ?? '')
  if (!found) {
    throw new NotFoundError('会話が見つかりません')
  }

  const name = c.req.param('file') ?? ''
  const image = imageAbsPath(user, found.folder, name)
  const file = image ? null : fileAbsPath(user, found.folder, name)
  const target = image ?? file
  if (!target) {
    throw new BadRequestError('ファイル名が不正です')
  }
  assertInsideDataDir(target)

  let body: Buffer
  try {
    body = await fs.readFile(target)
  } catch {
    throw new NotFoundError(image ? '画像が見つかりません' : 'ファイルが見つかりません')
  }

  const type = image ? 'image/jpeg' : fileContentType(name)
  if (!type) {
    throw new BadRequestError('ファイル名が不正です')
  }

  return c.body(new Uint8Array(body), 200, {
    'Content-Type': type,
    // 同じファイル名が再利用されることはないので長く持たせてよい。
    'Cache-Control': 'private, max-age=31536000, immutable',
  })
})
