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

/** JSON の中のテキスト欄を一つ取り出す。無い・文字列でないなら 400。 */
export async function readText(request: Request, key: string): Promise<string> {
  const value = (await readJson<Record<string, unknown>>(request))[key]
  if (typeof value !== 'string') throw new BadRequestError('保存する内容がありません')
  return value
}
