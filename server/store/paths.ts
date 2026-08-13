import path from 'node:path'
import { BadRequestError, NotFoundError } from '../errors'
import { config } from '../config'

declare const userBrand: unique symbol
declare const topicBrand: unique symbol
declare const refBrand: unique symbol

/** assertUser を通したユーザー名。素の string とは別型。 */
export type UserName = string & { readonly [userBrand]: 'user' }

/** assertTopicName / toTopicName を通したトピック名。 */
export type TopicName = string & { readonly [topicBrand]: 'topic' }

type TopicRefShape =
  | { kind: 'group'; topic: TopicName }
  | { kind: 'child'; topic: TopicName; sub: TopicName }

/**
 * 検証済みのトピック位置。assertTopicRef / topicRef だけが作る。
 * 入れ子は一段まで。slug 未定の途中状態は載せない。
 */
export type TopicRef = TopicRefShape & { readonly [refBrand]: 'TopicRef' }

/** 器（トップレベル）を指すか。 */
export function isGroupRef(ref: TopicRef): ref is TopicRef & { kind: 'group' } {
  return ref.kind === 'group'
}

/** TopicRef からフォルダ名（slug）を取り出す。 */
export function refSlug(ref: TopicRef): TopicName {
  return isGroupRef(ref) ? ref.topic : ref.sub
}

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
export function toTopicName(input: string): TopicName {
  const name = normalizeTopicName(input)
    .replace(FORBIDDEN_ALL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()

  return (isTopicName(name) ? name : `t-${crypto.randomUUID().slice(0, 8)}`) as TopicName
}

/**
 * isTopicName を通した名前だけを TopicName にする。
 * readdir の結果を濾したあとなど、すでに形が分かっているときに使う。
 */
export function trustedTopicName(name: string): TopicName {
  return normalizeTopicName(name) as TopicName
}

/** USERS に無い名前は存在しないものとして扱う。route 入口で呼ぶ。 */
export function assertUser(user: string): UserName {
  if (!config.users.includes(user)) {
    throw new NotFoundError('ユーザーが見つかりません')
  }
  return user as UserName
}

/** route 入口で呼ぶ。 */
export function assertTopicName(topic: string): TopicName {
  const name = normalizeTopicName(topic)
  if (!isTopicName(name)) {
    throw new BadRequestError('トピック名が不正です')
  }
  return name as TopicName
}

/** 検証済みの名前から TopicRef を組む。store 内の組み立て用。 */
export function topicRef(topic: TopicName, sub?: TopicName): TopicRef {
  return (sub ? { kind: 'child', topic, sub } : { kind: 'group', topic }) as TopicRef
}

/** 検証済みの user からディレクトリを組み立てる。 */
export function userDir(user: UserName): string {
  return path.join(config.dataDir, user)
}

export function topicsDir(user: UserName): string {
  return path.join(userDir(user), 'topics')
}

/** URL から届いた組を検査して ref にする。route 入口で呼ぶ。 */
export function assertTopicRef(topic: string, sub?: string | null): TopicRef {
  const parent = assertTopicName(topic)
  return sub ? topicRef(parent, assertTopicName(sub)) : topicRef(parent)
}

/** 検証済みの ref からディレクトリを組み立てる。 */
export function topicDir(user: UserName, ref: TopicRef): string {
  const dir = path.join(topicsDir(user), ref.topic)
  if (isGroupRef(ref)) return dir
  return path.join(dir, ref.sub)
}

export function logsDir(user: UserName, ref: TopicRef): string {
  return path.join(topicDir(user, ref), 'logs')
}

export function imagesDir(user: UserName, ref: TopicRef): string {
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
    throw new BadRequestError('不正なパスです')
  }
  return resolved
}
