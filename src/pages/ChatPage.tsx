import { useParams } from 'react-router-dom'

// Step 4 で実装する。
export default function ChatPage() {
  const { user, topic } = useParams()

  return (
    <main className="flex min-h-dvh flex-col p-4">
      <header className="pb-4">
        <h1 className="text-lg font-semibold">{topic}</h1>
        <p className="text-muted text-xs">{user}</p>
      </header>
      <p className="text-muted text-sm">（Step 4 で作る）</p>
    </main>
  )
}
