import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { api } from '@/lib/api'
import { rememberUser, rememberedUser } from '@/lib/remember'
import { FamilySpace, PersonalSpace } from '@/lib/space'
import TopicListPage from './pages/TopicListPage'
import GroupPage from './pages/GroupPage'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null
  if (next.startsWith('/family') || next.startsWith('/user')) return next
  return null
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/user" replace />} />
      <Route path="/user" element={<UserPicker />} />
      {/* 一覧・器・会話の三画面は、どちらのスペースでも同じものを使う。 */}
      <Route path="/user/:user" element={<PersonalSpace />}>
        <Route index element={<TopicListPage />} />
        <Route path=":topic" element={<GroupPage />} />
        <Route path=":topic/:sub" element={<ChatPage />} />
      </Route>
      <Route path="/family" element={<FamilySpace />}>
        <Route index element={<TopicListPage />} />
        <Route path=":topic" element={<GroupPage />} />
        <Route path=":topic/:sub" element={<ChatPage />} />
      </Route>
      {/* 家族の誰の画面でもない。鍵は URL の ?key= で渡す。 */}
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

/**
 * 名前の入っていない入口。この端末で一度でも開けた名前があればそこへ送る。
 * 覚えが無ければ名前を入れる（または名前入りの URL を開く）。
 *
 * 打ち間違えたまま覚えると、共有スペースは開けるのに書くときだけ弾かれて、
 * 何が悪いのか分からなくなる。名前は入れた時点で照らし合わせておく。
 */
function UserPicker() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const remembered = rememberedUser()
  const [name, setName] = useState('')
  const [users, setUsers] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const native = Capacitor.isNativePlatform()
  const next = safeNext(params.get('next'))

  useEffect(() => {
    api
      .health()
      .then((health) => setUsers(health.users))
      .catch(() => {})
  }, [])

  if (remembered) {
    const dest = next ?? `/user/${encodeURIComponent(remembered)}`
    return <Navigate to={dest} replace />
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const user = name.trim()
    if (!user) return
    // 一覧が取れなかったときは止めない。名前を入れる道まで塞ぐことになる。
    if (users && !users.includes(user)) {
      setError('その名前は登録されていないよ。綴りを確かめてね')
      return
    }
    rememberUser(user)
    const dest = next ?? `/user/${encodeURIComponent(user)}`
    navigate(dest, { replace: true })
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">kokuboke</h1>
      <p className="text-muted max-w-sm text-sm leading-relaxed">
        {native
          ? '自分の名前を入れてね。この端末では次から覚えているよ。'
          : '自分の名前を入れるか、名前入りの URL をホーム画面に追加して使ってね。'}
      </p>
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-2">
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          placeholder="taro"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          aria-label="名前"
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
        <Button type="submit" disabled={!name.trim()}>
          はじめる
        </Button>
      </form>
    </main>
  )
}

function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <p className="text-muted text-sm">ページが見つかりません</p>
    </main>
  )
}
