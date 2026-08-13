import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { TopicRef } from '../../shared/types'
import { config } from '../config'

export type { TopicRef }

/**
 * トピックの名前はそのままフォルダ名になり、URL にも出る。日本語も通す。
 * 弾くのは、パスの区切りになるものと、SMB で共有したときに扱えなくなるもの。
 */
const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f\u007f]/
/** 落とすとき用。global な正規表現は test() で lastIndex が残るので分けて持つ。 */
const FORBIDDEN_ALL = new RegExp(FORBIDDEN.source, 'g')

/** ext4 のファイル名は 255 バイトまで。日本語は 1 文字 3 バイトなので余裕を持たせる。 */
const MAX_BYTES = 180

/** 比較と保存の前に必ず通す。濁点の分かれた形（NFD）を合成済み（NFC）に寄せる。 */
export function normalizeTopicName(value: string): string {
  return value.normalize('NFC').trim()
}

export function isTopicName(value: string): boolean {
  const name = normalizeTopicName(value)
  if (!name || name === '.' || name === '..') return false
  // 先頭のドットは隠しファイル扱いになり、末尾のドットは SMB で落ちる。
  if (name.startsWith('.') || name.endsWith('.')) return false
  if (FORBIDDEN.test(name)) return false
  return Buffer.byteLength(name) <= MAX_BYTES
}

/**
 * 入力からフォルダ名をつくる。使えない文字を落としてもなお残らない名前だけ、
 * 機械的な名前に落とす。
 */
export function toTopicName(input: string): string {
  const name = normalizeTopicName(input)
    .replace(FORBIDDEN_ALL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()

  return isTopicName(name) ? name : `t-${crypto.randomUUID().slice(0, 8)}`
}

/** USERS に無い名前は存在しないものとして扱う。 */
export function assertUser(user: string): string {
  if (!config.users.includes(user)) {
    throw new HTTPException(404, { message: 'ユーザーが見つかりません' })
  }
  return user
}

export function assertTopicName(topic: string): string {
  const name = normalizeTopicName(topic)
  if (!isTopicName(name)) {
    throw new HTTPException(400, { message: 'トピック名が不正です' })
  }
  return name
}

export function userDir(user: string): string {
  return path.join(config.dataDir, assertUser(user))
}

export function topicsDir(user: string): string {
  return path.join(userDir(user), 'topics')
}

/** URL から届いた組を検査して ref にする。 */
export function assertTopicRef(topic: string, sub?: string | null): TopicRef {
  const parent = assertTopicName(topic)
  return sub ? { topic: parent, sub: assertTopicName(sub) } : { topic: parent }
}

/**
 * 器（トップレベル）を指すか。`sub` が無いときだけ真。
 * 空文字は「子の途中状態」なので偽（`!ref.sub` だと真になってしまう）。
 */
export function isGroupRef(ref: TopicRef): boolean {
  return ref.sub === undefined
}

export function topicDir(user: string, ref: TopicRef): string {
  const dir = path.join(topicsDir(user), assertTopicName(ref.topic))
  if (isGroupRef(ref)) return dir
  return path.join(dir, assertTopicName(ref.sub!))
}

export function logsDir(user: string, ref: TopicRef): string {
  return path.join(topicDir(user, ref), 'logs')
}

export function imagesDir(user: string, ref: TopicRef): string {
  return path.join(topicDir(user, ref), 'images')
}

/**
 * 組み立てたパスがデータディレクトリの外へ出ていないか最後に検査する。
 * 名前は個別に検査しているが、二重の歯止めとして置いておく。
 */
export function assertInsideDataDir(target: string): string {
  const resolved = path.resolve(target)
  const root = path.resolve(config.dataDir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HTTPException(400, { message: '不正なパスです' })
  }
  return resolved
}
