import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FolderPlus, NotebookPen, Plus } from 'lucide-react'
import type { Topic, TopicRef } from '../../shared/types'
import { api } from '@/lib/api'
import { relativeLabel } from '@/lib/format'
import { rememberUser } from '@/lib/remember'
import { topicHref } from '@/lib/route'
import { Button } from '@/components/ui/button'
import { MemoryDialog } from '@/components/MemoryDialog'
import { NewTopicDialog } from '@/components/NewTopicDialog'

export default function TopicListPage() {
  const { user = '' } = useParams()
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 新規作成の相手。null ならトップレベル、文字列ならそのトピックの中。 */
  const [creating, setCreating] = useState<string | null | undefined>(undefined)
  const [memoryFor, setMemoryFor] = useState<TopicRef | null>(null)

  const load = useCallback(() => {
    api
      .listTopics(user)
      .then((list) => {
        // ここまで来た名前だけを端末に残す。存在しない名前は 404 で弾かれる。
        rememberUser(user)
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
        <Button size="sm" onClick={() => setCreating(null)}>
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
          {topics?.map((topic) =>
            topic.children.length > 0 ? (
              <li key={topic.slug} className="pt-1">
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <span className="text-base">{topic.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {topic.name}
                  </span>
                  <IconButton
                    label={`${topic.name} の記憶`}
                    onClick={() => setMemoryFor({ topic: topic.slug })}
                  >
                    <NotebookPen className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`${topic.name} の中に作る`}
                    onClick={() => setCreating(topic.slug)}
                  >
                    <Plus className="size-4" />
                  </IconButton>
                </div>

                <ul className="ml-3 flex flex-col gap-1.5 border-l pl-3">
                  {topic.children.map((child) => (
                    <TopicCard
                      key={child.slug}
                      topic={child}
                      href={topicHref(user, { topic: topic.slug, sub: child.slug })}
                    />
                  ))}
                </ul>
              </li>
            ) : (
              <TopicCard
                key={topic.slug}
                topic={topic}
                href={topicHref(user, { topic: topic.slug })}
                onSplit={() => setCreating(topic.slug)}
              />
            ),
          )}
        </ul>
      </main>

      <NewTopicDialog
        open={creating !== undefined}
        parent={creating ?? null}
        onOpenChange={(open) => !open && setCreating(undefined)}
        onCreate={async (input) => {
          if (creating) await api.createChild(user, creating, input)
          else await api.createTopic(user, input)
          load()
        }}
      />

      <MemoryDialog
        user={user}
        target={memoryFor}
        open={memoryFor !== null}
        onOpenChange={(open) => !open && setMemoryFor(null)}
      />
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground size-8 shrink-0"
    >
      {children}
    </Button>
  )
}

function TopicCard({
  topic,
  href,
  onSplit,
}: {
  topic: Topic
  href: string
  onSplit?: () => void
}) {
  return (
    <li className="flex items-center gap-1">
      <Link
        to={href}
        className="hover:bg-accent active:bg-accent flex min-w-0 flex-1 items-center gap-3 rounded-xl border p-3 transition-colors"
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

      {onSplit && (
        <IconButton label={`${topic.name} の中を分ける`} onClick={onSplit}>
          <FolderPlus className="size-4" />
        </IconButton>
      )}
    </li>
  )
}
