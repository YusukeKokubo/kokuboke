import fs from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import sharp from 'sharp'
import { config } from '../config'
import type { Message } from '../../shared/types'
import { imagesDir, isGroupRef, type TopicRef } from './paths'
import { localDate } from './date'

export interface SavedImage {
  /** ログに残すファイル名。トピックのフォルダの中で一意。 */
  name: string
  /** CLI に渡す絶対パス。 */
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
export async function saveImage(user: string, ref: TopicRef, file: File): Promise<SavedImage> {
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

  const dir = imagesDir(user, ref)
  await fs.mkdir(dir, { recursive: true })

  const name = filename(new Date())
  const absPath = path.join(dir, name)
  await fs.writeFile(absPath, output)

  return { name, absPath }
}

/**
 * ログに残っている値からファイル名を取り出す。
 * 以前は `/media/...` の URL を保存していたので、古いログはそのまま入っている。
 */
export function imageName(stored: string): string {
  return stored.split('/').pop() ?? stored
}

/**
 * ブラウザから参照する URL。保存はせず、返すときに組み立てる。
 * トピック名には日本語も `#` も入りうるので、区切りごとに符号化する。
 * 素で入れると `#` から先が断片として切り落とされる。
 * 子トピックの分は、経路の途中に `sub` を挟んで親と区別する。
 */
export function mediaUrl(user: string, ref: TopicRef, stored: string): string {
  const segments = isGroupRef(ref)
    ? [user, ref.topic]
    : [user, ref.topic, 'sub', ref.sub!]
  segments.push(imageName(stored))
  return `/media/${segments.map(encodeURIComponent).join('/')}`
}

/** API で返す形に直す。ログにはファイル名しか入っていない。 */
export function withImageUrls(user: string, ref: TopicRef, message: Message): Message {
  if (message.images.length === 0) return message
  return { ...message, images: message.images.map((name) => mediaUrl(user, ref, name)) }
}

/** 保存済み画像のファイル名から実ファイルの位置を割り出す。 */
export function imageAbsPath(user: string, ref: TopicRef, name: string): string | null {
  if (!/^[\w.-]+\.jpg$/.test(name)) return null
  return path.join(imagesDir(user, ref), name)
}
