import { useState, type FormEvent } from 'react'
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { rememberUser, rememberedUser } from '@/lib/remember'
import TopicListPage from './pages/TopicListPage'
import GroupPage from './pages/GroupPage'
import ChatPage from './pages/ChatPage'
import FamilyTopicListPage from './pages/FamilyTopicListPage'
import FamilyGroupPage from './pages/FamilyGroupPage'
import FamilyChatPage from './pages/FamilyChatPage'
import AdminPage from './pages/AdminPage'
import { FamilyGuard } from '@/components/FamilyGuard'
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
      <Route path="/user/:user" element={<TopicListPage />} />
      <Route path="/user/:user/:topic" element={<GroupPage />} />
      <Route path="/user/:user/:topic/:sub" element={<ChatPage />} />
      <Route
        path="/family"
        element={
          <FamilyGuard>
            <FamilyTopicListPage />
          </FamilyGuard>
        }
      />
      <Route
        path="/family/:topic"
        element={
          <FamilyGuard>
            <FamilyGroupPage />
          </FamilyGuard>
        }
      />
      <Route
        path="/family/:topic/:sub"
        element={
          <FamilyGuard>
            <FamilyChatPage />
          </FamilyGuard>
        }
      />
      {/* 家族の誰の画面でもない。鍵は URL の ?key= で渡す。 */}
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

/**
 * 名前の入っていない入口。この端末で一度でも開けた名前があればそこへ送る。
 * 誰がいるかは尋ねられないので、覚えが無ければ名前を入れる（または URL を開く）。
 */
function UserPicker() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const remembered = rememberedUser()
  const [name, setName] = useState('')
  const native = Capacitor.isNativePlatform()
  const next = safeNext(params.get('next'))

  if (remembered) {
    const dest = next ?? `/user/${encodeURIComponent(remembered)}`
    return <Navigate to={dest} replace />
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const user = name.trim()
    if (!user) return
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
          onChange={(event) => setName(event.target.value)}
          placeholder="taro"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          aria-label="名前"
        />
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
