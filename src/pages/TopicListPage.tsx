import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpace } from '@/lib/space'
import { Composer } from '@/components/Composer'
import { useTopics } from '@/components/TopicSidebar'

export default function TopicListPage() {
  const space = useSpace()
  const navigate = useNavigate()
  const { reload } = useTopics()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start(input: { text: string; images: File[] }) {
    if (starting) return
    setStarting(true)
    setError(null)
    try {
      const topic = await space.api.createTopic({})
      reload()
      navigate(space.href(topic.slug), { state: { draft: input } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '始められませんでした')
      setStarting(false)
      throw cause
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-3">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-10">
        <h2 className="px-4 text-center text-2xl font-medium tracking-tight">{space.greeting}</h2>
        <div className="w-full">
          <Composer
            placement="inline"
            placeholder="話しかけてみて"
            disabled={starting}
            keepOnFailure
            onSend={start}
          />
        </div>
        {error && <p className="text-destructive text-center text-sm">{error}</p>}
      </div>
    </main>
  )
}
