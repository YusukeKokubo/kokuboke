import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { Topic } from '../../shared/types'
import { api } from '@/lib/api'
import { relativeLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { NewTopicDialog } from '@/components/NewTopicDialog'

export default function TopicListPage() {
  const { user = '' } = useParams()
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(() => {
    api
      .listTopics(user)
      .then((list) => {
        setTopics(list)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [user])

  useEffect(load, [load])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-base font-semibold">{user}</h1>
          <p className="text-muted-foreground text-xs">トピック</p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
          新しく作る
        </Button>
      </header>

      <main className="flex-1 px-3 py-3">
        {error && <p className="text-destructive px-1 py-8 text-center text-sm">{error}</p>}

        {!error && topics === null && (
          <p className="text-muted-foreground px-1 py-8 text-center text-sm">読み込み中…</p>
        )}

        {topics?.length === 0 && (
          <div className="text-muted-foreground px-6 py-16 text-center text-sm leading-relaxed">
            まだトピックがないよ。
            <br />
            「数学学習」「スキンケア」みたいに、
            <br />
            話題ごとに作ってみて。
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          {topics?.map((topic) => (
            <li key={topic.slug}>
              <Link
                to={`/user/${user}/${topic.slug}`}
                className="hover:bg-accent active:bg-accent flex items-center gap-3 rounded-xl border p-3 transition-colors"
              >
                <span className="bg-secondary flex size-11 shrink-0 items-center justify-center rounded-full text-xl">
                  {topic.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-medium">{topic.name}</span>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {relativeLabel(topic.lastMessageAt)}
                    </span>
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {topic.preview ?? 'まだ話していないよ'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <NewTopicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={async (input) => {
          await api.createTopic(user, input)
          load()
        }}
      />
    </div>
  )
}
