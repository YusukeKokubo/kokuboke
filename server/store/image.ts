import fs from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import sharp from 'sharp'
import { config } from '../config'
import { imagesDir } from './paths'
import { localDate } from './log'

export interface SavedImage {
  /** ブラウザから参照する URL。 */
  url: string
  /** Claude Code に渡す絶対パス。 */
  absPath: string
}

const HEIC = /^image\/(heic|heif)$/i

function filename(at: Date): string {
  const date = localDate(at).replaceAll('-', '')
  const time = at.toLocaleTimeString('sv-SE', { hour12: false }).replaceAll(':', '')
  // 同じ秒に複数枚届いても衝突しないよう短い乱数を足す。
  return `${date}_${time}_${crypto.randomUUID().slice(0, 4)}.jpg`
}

/**
 * 受け取った画像を JPEG に正規化して保存する。
 * 原寸のまま渡すとトークンを無駄に食うので長辺を縮める。
 */
export async function saveImage(user: string, topic: string, file: File): Promise<SavedImage> {
  if (file.size > config.uploadMaxBytes) {
    throw new HTTPException(413, { message: '画像が大きすぎます' })
  }

  let input = Buffer.from(await file.arrayBuffer())

  if (HEIC.test(file.type)) {
    // sharp の配布バイナリは HEIC を読めないので、先に JPEG へ変換する。
    const heicConvert = (await import('heic-convert')).default
    // 型定義は ArrayBufferLike を要求するが、実装は Buffer をそのまま受け取る。
    const buffer = input as unknown as ArrayBufferLike
    input = Buffer.from(await heicConvert({ buffer, format: 'JPEG', quality: 0.9 }))
  }

  let output: Buffer
  try {
    output = await sharp(input)
      // 撮影時の向きを実ピクセルに焼き込む。横倒しのまま渡すと読み違える。
      .rotate()
      .resize({
        width: config.imageMaxEdge,
        height: config.imageMaxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch {
    throw new HTTPException(400, { message: '画像を読み取れませんでした' })
  }

  const dir = imagesDir(user, topic)
  await fs.mkdir(dir, { recursive: true })

  const name = filename(new Date())
  const absPath = path.join(dir, name)
  await fs.writeFile(absPath, output)

  return { url: `/media/${user}/${topic}/${name}`, absPath }
}

/** 保存済み画像の URL から実ファイルの位置を割り出す。 */
export function imageAbsPath(user: string, topic: string, url: string): string | null {
  const name = url.split('/').pop()
  if (!name || !/^[\w.-]+\.jpg$/.test(name)) return null
  return path.join(imagesDir(user, topic), name)
}
