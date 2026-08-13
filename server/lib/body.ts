import { BadRequestError } from '../errors'

/**
 * JSON のボディを読む。空のまま送られてくる経路もあるので、
 * 中身が無いときは空のオブジェクトとして扱う。壊れている場合だけ弾く。
 */
export async function readJson<T>(request: Request): Promise<T> {
  const raw = await request.text().catch(() => '')
  if (!raw.trim()) return {} as T

  try {
    return JSON.parse(raw) as T
  } catch {
    throw new BadRequestError('リクエストの形式が不正です')
  }
}
