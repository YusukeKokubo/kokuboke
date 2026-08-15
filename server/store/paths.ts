import path from 'node:path'
import { BadRequestError, NotFoundError } from '../errors'
import { config } from '../config'
import { FORBIDDEN_ALL, isTopicName, normalizeTopicName } from './topic-name'

export { isTopicName, normalizeTopicName } from './topic-name'

declare const userBrand: unique symbol
declare const topicBrand: unique symbol

/** assertUser を通したユーザー名。素の string とは別型。 */
export type UserName = string & { readonly [userBrand]: 'user' }

/**
 * assertTopicName / toTopicName を通した名前。
 * 会話フォルダ名（YY-MM-DD-見出し）とタグ名の両方に使う。
 */
export type TopicName = string & { readonly [topicBrand]: 'topic' }

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

/** 家族共有スペース用。config.users には入れないが、パス組み立ては個人と同じ。 */
export function familyUser(): UserName {
  return config.familyDir as UserName
}

/** 共有スペースの発言者。USERS に無い名前は 400。 */
export function assertAuthor(author: string): string {
  if (!config.users.includes(author)) {
    throw new BadRequestError('発言者が不正です')
  }
  return author
}

/** route 入口で呼ぶ。会話 id とタグ名の両方に使う。 */
export function assertTopicName(topic: string): TopicName {
  const name = asTopicName(topic)
  if (!name) {
    throw new BadRequestError('名前が不正です')
  }
  return name
}

/** 検証済みの user からディレクトリを組み立てる。 */
export function userDir(user: UserName): string {
  return path.join(config.dataDir, user)
}

export function topicsDir(user: UserName): string {
  return path.join(userDir(user), 'topics')
}

export function tagsDir(user: UserName): string {
  return path.join(userDir(user), 'tags')
}

export function tagFile(user: UserName, tag: TopicName): string {
  return path.join(tagsDir(user), `${tag}.md`)
}

/** タグ名 → 絵文字。本文の markdown とは別ファイル。 */
export function tagsMetaFile(user: UserName): string {
  return path.join(userDir(user), 'tags.json')
}

/** 検証済みの id から会話ディレクトリを組み立てる。 */
export function topicDir(user: UserName, id: TopicName): string {
  return path.join(topicsDir(user), id)
}

export function logsDir(user: UserName, id: TopicName): string {
  return path.join(topicDir(user, id), 'logs')
}

export function imagesDir(user: UserName, id: TopicName): string {
  return path.join(topicDir(user, id), 'images')
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
