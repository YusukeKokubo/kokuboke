import { Navigate, Route, Routes } from 'react-router-dom'
import TopicListPage from './pages/TopicListPage'
import ChatPage from './pages/ChatPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/user" replace />} />
      <Route path="/user" element={<UserPicker />} />
      <Route path="/user/:user" element={<TopicListPage />} />
      <Route path="/user/:user/:topic" element={<ChatPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function UserPicker() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">kokuboke</h1>
      <p className="text-muted text-sm leading-relaxed">
        自分の名前が入った URL をホーム画面に追加して使ってね。
        <br />
        たとえば <code className="text-accent">/user/taro</code>
      </p>
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
