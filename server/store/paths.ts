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

type VerifiedTopicRefShape =
  | { kind: 'group'; topic: TopicName }
  | { kind: 'child'; topic: TopicName; sub: TopicName }

/**
 * 検証済みのトピック位置。assertTopicRef / topicRef だけが作る。
 * 入れ子は一段まで。slug 未定の途中状態は載せない。
 * 画面側の TopicRef（shared/types）とは別物。
 */
export type VerifiedTopicRef = VerifiedTopicRefShape & { readonly [refBrand]: 'VerifiedTopicRef' }

/** 器（トップレベル）を指すか。 */
export function isGroupRef(ref: VerifiedTopicRef): ref is VerifiedTopicRef & { kind: 'group' } {
  return ref.kind === 'group'
}

/** VerifiedTopicRef からフォルダ名（slug）を取り出す。 */
export function refSlug(ref: VerifiedTopicRef): TopicName {
  return isGroupRef(ref) ? ref.topic : ref.sub
}

/**
 * トピックの名前はそのままフォルダ名になり、URL にも出る。日本語も通す。
 * 弾くのは、パスの区切りになるものと、SMB で共有したときに扱えなくなるもの。
 * 制御文字を意図的に弾くので no-control-regex は無効にする。
 */
// eslint-disable-next-line no-control-regex -- ファイル名に制御文字を入れないための検査
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
 * 濾しとブランド化を一手で。通らない名前は null。
 * readdir の結果など、まだ検証していない文字列に使う。
 */
export function asTopicName(name: string): TopicName | null {
  const value = normalizeTopicName(name)
  return isTopicName(value) ? (value as TopicName) : null
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
  const name = asTopicName(topic)
  if (!name) {
    throw new BadRequestError('トピック名が不正です')
  }
  return name
}

/** 検証済みの名前から VerifiedTopicRef を組む。store 内の組み立て用。 */
export function topicRef(topic: TopicName, sub?: TopicName): VerifiedTopicRef {
  return (sub ? { kind: 'child', topic, sub } : { kind: 'group', topic }) as VerifiedTopicRef
}

/** 検証済みの user からディレクトリを組み立てる。 */
export function userDir(user: UserName): string {
  return path.join(config.dataDir, user)
}

export function topicsDir(user: UserName): string {
  return path.join(userDir(user), 'topics')
}

/** URL から届いた組を検査して ref にする。route 入口で呼ぶ。 */
export function assertTopicRef(topic: string, sub?: string | null): VerifiedTopicRef {
  const parent = assertTopicName(topic)
  return sub ? topicRef(parent, assertTopicName(sub)) : topicRef(parent)
}

/** 検証済みの ref からディレクトリを組み立てる。 */
export function topicDir(user: UserName, ref: VerifiedTopicRef): string {
  const dir = path.join(topicsDir(user), ref.topic)
  if (isGroupRef(ref)) return dir
  return path.join(dir, ref.sub)
}

export function logsDir(user: UserName, ref: VerifiedTopicRef): string {
  return path.join(topicDir(user, ref), 'logs')
}

export function imagesDir(user: UserName, ref: VerifiedTopicRef): string {
  return path.join(topicDir(user, ref), 'images')
}

/**
 * 危ない操作の直前だけに置く追加の確認。組み立てたパスがデータディレクトリの
 * 外へ出ていないかを見る。
 *
 * 呼ばれるのは二箇所だけ。(1) media が URL から来た任意のファイル名で実ファイルを
 * 読む直前、(2) deleteTopic が再帰削除する直前。ブランド型で検証済みの値しか
 * パス組み立てに入らない仕組みがあるので、通常の読み書きには足さない。
 */
export function assertInsideDataDir(target: string): string {
  const resolved = path.resolve(target)
  const root = path.resolve(config.dataDir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new BadRequestError('不正なパスです')
  }
  return resolved
}
