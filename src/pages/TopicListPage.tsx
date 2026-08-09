import { useParams } from 'react-router-dom'

// Step 4 で実装する。ここではルーティングが通ることだけ確認できるようにしておく。
export default function TopicListPage() {
  const { user } = useParams()

  return (
    <main className="flex min-h-dvh flex-col p-4">
      <header className="pb-4">
        <h1 className="text-lg font-semibold">{user}</h1>
        <p className="text-muted text-xs">トピック一覧</p>
      </header>
      <p className="text-muted text-sm">（Step 4 で作る）</p>
    </main>
  )
}
