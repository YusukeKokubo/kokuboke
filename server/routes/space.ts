import type { Context } from 'hono'
import { BadRequestError, NotFoundError } from '../errors'
import type { Audience } from '../agent/prompt'
import {
  assertAuthor,
  assertTopicRef,
  assertUser,
  familyUser,
  isGroupRef,
  type VerifiedTopicRef,
  type UserName,
} from '../store/paths'
import { topicExists } from '../store/topic'
import { readProfile } from '../store/user'

/**
 * 個人のスペースと家族共有スペースの違いをまとめた値。
 *
 * store 層では両者はただの user 配下で、`topicDir` から下はまったく同じ道を通る。
 * 違うのは経路の形・順番待ちの鍵の粒度・発言者を名乗るかどうか・AI への説明だけ。
 * その差をここに集めて、ハンドラは一つだけ書き、経路を両方に載せる。
 */
export interface Space {
  kind: 'personal' | 'family'
  user: UserName
  /** 画像 URL の `/media/` 直下に置く区切り。 */
  mediaSegment: string
  /** AI に「誰と話しているか」を説明するための材料。 */
  audience: Audience
  /**
   * 順番待ちの鍵。個人は人ごとに一つで、同じ人の多重送信をここで弾く。
   * 共有スペースはトピックごとで、別の話なら家族が同時に話せる。
   */
  busyKey(ref: VerifiedTopicRef): string
  /** 鍵がトピックごとに分かれているか。器を消すとき、中の子まで見る必要があるかの判断に使う。 */
  busyPerTopic: boolean
  /** 発言者。共有スペースは必ず名乗る。個人は URL 自体がその人のものなので付けない。 */
  authorOf(body: Record<string, unknown>): string | undefined
  /** profile.md の中身。共有スペースには置かないので空文字。 */
  profile(): Promise<string>
}

/** `/media/family/...` と `/api/family/...` で使う区切り。config が USERS に禁じている。 */
const FAMILY = 'family'

function personalSpace(user: UserName): Space {
  return {
    kind: 'personal',
    user,
    mediaSegment: user,
    audience: { kind: 'personal', user },
    busyKey: () => user,
    busyPerTopic: false,
    authorOf: () => undefined,
    profile: () => readProfile(user),
  }
}

function familySpace(): Space {
  const user = familyUser()
  return {
    kind: 'family',
    user,
    mediaSegment: FAMILY,
    audience: { kind: 'family' },
    // 個人のユーザー名とぶつからないよう区切りを挟む。器は `_family:器`、子は `_family:器/子`。
    busyKey: (ref) => (isGroupRef(ref) ? `${user}:${ref.topic}` : `${user}:${ref.topic}/${ref.sub}`),
    busyPerTopic: true,
    authorOf: (body) => {
      const raw = typeof body.author === 'string' ? body.author.trim() : ''
      if (!raw) {
        throw new BadRequestError('発言者を指定してください')
      }
      return assertAuthor(raw)
    },
    profile: async () => '',
  }
}

/**
 * 個人と共有スペースの両方の経路を返す。ハンドラは一つで足りる。
 * 共有スペースの側に `:user` は無いので、`resolveSpace` は名前の有無で見分ける。
 */
export function spacePaths(suffix = ''): string[] {
  return [`/api/users/:user${suffix}`, `/api/${FAMILY}${suffix}`]
}

/**
 * トピックを指す経路。入れ子は一段だけで、親と子で処理は変わらないので、
 * `sub` の有無だけが違う形も一緒に返して同じハンドラに載せる。
 */
export function topicPaths(suffix = ''): string[] {
  return [
    ...spacePaths(`/topics/:topic${suffix}`),
    ...spacePaths(`/topics/:topic/sub/:sub${suffix}`),
  ]
}

/**
 * 経路からどのスペースかを決める。共有スペースの経路に `:user` は無いので、
 * 名前が取れなければ共有スペース。名前が取れたなら USERS に照らす。
 */
export function resolveSpace(c: Context): Space {
  const named = c.req.param('user')
  return named === undefined ? familySpace() : personalSpace(assertUser(named))
}

/**
 * `/media/` の下だけは区切りが一つしかなく、名前の位置に `family` が入る。
 * config が USERS に `family` を禁じているので、人の名前と取り違えることはない。
 */
export function resolveMediaSpace(c: Context): Space {
  const segment = c.req.param('user') ?? ''
  return segment === FAMILY ? familySpace() : personalSpace(assertUser(segment))
}

export function target(c: Context): { space: Space; ref: VerifiedTopicRef } {
  // 経路を配列で渡すと Hono が名前を推論できないので、空文字に落として検査に回す。
  return {
    space: resolveSpace(c),
    ref: assertTopicRef(c.req.param('topic') ?? '', c.req.param('sub')),
  }
}

/** 経路から取り出したうえで、実体があることまで確かめる。 */
export async function requireTopic(c: Context): Promise<{ space: Space; ref: VerifiedTopicRef }> {
  const found = target(c)
  if (!(await topicExists(found.space.user, found.ref))) {
    throw new NotFoundError('トピックが見つかりません')
  }
  return found
}
