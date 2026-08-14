import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { isGroupRef, type TopicRef } from '../../shared/types'
import { spaceApi, type SpaceApi } from '@/lib/api'
import { rememberUser, rememberedUser } from '@/lib/remember'

/**
 * 画面がどのスペースに居るか。個人と家族共有スペースの違いをここに集める。
 * 一覧・器・会話の三画面は、この値の中身が変わるだけで同じものを使う。
 */
export interface Space {
  kind: 'personal' | 'family'
  /** トピック一覧の URL。会話画面の戻り先。 */
  home: string
  title: string
  subtitle: string
  /** まだ何も無いときの誘い文。 */
  emptyHint: ReactNode
  /** 発言に添える名前。個人のスペースでは URL 自体がその人のものなので付けない。 */
  author?: string
  /** このスペースの持ち主。共有スペースは誰のものでもないので undefined。 */
  owner?: string
  api: SpaceApi
  /** トピック画面への経路。子なら器の下に続ける。 */
  href(ref: TopicRef): string
  /** 文書を読み直す目印。スペースやトピックが変われば読み直させる。 */
  docKey(ref?: TopicRef | null): string
  /**
   * 順番待ちで弾かれたときの言い換え。共有スペースでは「誰か」が話しているので、
   * サーバーの言い方のままだと自分が待たされている理由が分からない。
   */
  busyNotice(message: string): string
  /**
   * この端末で開けた名前を残す。存在しない名前を覚えると、次から壊れた画面へ
   * 送られ続けるので、読み込みが通ってから呼ぶ。
   */
  confirm(): void
}

const SpaceContext = createContext<Space | null>(null)

export function useSpace(): Space {
  const space = useContext(SpaceContext)
  if (!space) throw new Error('スペースの外で useSpace を呼んでいます')
  return space
}

function refKey(ref?: TopicRef | null): string {
  if (!ref) return ':'
  return isGroupRef(ref) ? `${ref.topic}:` : `${ref.topic}:${ref.sub}`
}

/** その人のトピック一覧の URL。スペースの外（管理画面）からも組み立てる。 */
export function personalHome(user: string): string {
  return `/user/${encodeURIComponent(user)}`
}

/** トピック画面への経路。子なら器の下に続ける。`home` は一覧の URL。 */
export function topicHref(home: string, ref: TopicRef): string {
  const base = `${home}/${encodeURIComponent(ref.topic)}`
  return isGroupRef(ref) ? base : `${base}/${encodeURIComponent(ref.sub)}`
}

/** 個人のスペース。`/user/:user` の下。 */
export function PersonalSpace() {
  const { user = '' } = useParams()

  const space = useMemo((): Space => {
    const home = personalHome(user)
    return {
      kind: 'personal',
      home,
      title: user,
      subtitle: 'トピック',
      owner: user,
      emptyHint: (
        <>
          「数学学習」「スキンケア」みたいに、
          <br />
          話題ごとに作ってみて。
        </>
      ),
      api: spaceApi(`/api/users/${encodeURIComponent(user)}`),
      href: (ref) => topicHref(home, ref),
      docKey: (ref) => `${user}:${refKey(ref)}`,
      busyNotice: (message) => message,
      confirm: () => rememberUser(user),
    }
  }, [user])

  return (
    <SpaceContext.Provider value={space}>
      <Outlet />
    </SpaceContext.Provider>
  )
}

/**
 * 家族共有スペース。`/family` の下。
 * 書くには名乗る名前が要るので、覚えが無ければ入口へ送り、戻り先を渡す。
 */
export function FamilySpace() {
  const location = useLocation()
  const author = rememberedUser()

  const space = useMemo((): Space | null => {
    if (!author) return null
    return {
      kind: 'family',
      home: '/family',
      title: '共有スペース',
      subtitle: '家族のメモ・買い物',
      emptyHint: (
        <>
          買い物リストや旅行のメモなど、
          <br />
          家族みんなの話題を作ってみて。
        </>
      ),
      author,
      api: spaceApi('/api/family', author),
      href: (ref) => topicHref('/family', ref),
      docKey: (ref) => `family:${refKey(ref)}`,
      busyNotice: (message) =>
        message.includes('前の返答をまだ書いています')
          ? 'いま誰かが話しとる。少し待ってから試してね'
          : message,
      confirm: () => {},
    }
  }, [author])

  if (!space) {
    return <Navigate to={`/user?next=${encodeURIComponent(location.pathname)}`} replace />
  }

  return (
    <SpaceContext.Provider value={space}>
      <Outlet />
    </SpaceContext.Provider>
  )
}
