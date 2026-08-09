import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import { config } from '../config'

/** URL とフォルダ名に使う識別子。日本語の表示名とは別に持つ。 */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/

export function isSlug(value: string): boolean {
  return SLUG.test(value)
}

/**
 * 表示名から識別子をつくる。日本語だけの名前は英数字が残らないので、
 * その場合はランダムな識別子にフォールバックする。
 */
export function toSlug(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')

  return isSlug(ascii) ? ascii : `t-${crypto.randomUUID().slice(0, 8)}`
}

/** USERS に無い名前は存在しないものとして扱う。 */
export function assertUser(user: string): string {
  if (!config.users.includes(user)) {
    throw new HTTPException(404, { message: 'ユーザーが見つかりません' })
  }
  return user
}

export function assertTopicSlug(topic: string): string {
  if (!isSlug(topic)) {
    throw new HTTPException(400, { message: 'トピック名が不正です' })
  }
  return topic
}

export function userDir(user: string): string {
  return path.join(config.dataDir, assertUser(user))
}

export function topicsDir(user: string): string {
  return path.join(userDir(user), 'topics')
}

export function topicDir(user: string, topic: string): string {
  return path.join(topicsDir(user), assertTopicSlug(topic))
}

export function logsDir(user: string, topic: string): string {
  return path.join(topicDir(user, topic), 'logs')
}

export function imagesDir(user: string, topic: string): string {
  return path.join(topicDir(user, topic), 'images')
}

/**
 * 組み立てたパスがデータディレクトリの外へ出ていないか最後に検査する。
 * 識別子は正規表現で縛ってあるが、二重の歯止めとして置いておく。
 */
export function assertInsideDataDir(target: string): string {
  const resolved = path.resolve(target)
  const root = path.resolve(config.dataDir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HTTPException(400, { message: '不正なパスです' })
  }
  return resolved
}
