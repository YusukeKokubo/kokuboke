import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { NotebookPen, Plus, ScrollText, Settings2 } from 'lucide-react'
import type { Topic, TopicRef } from '../../shared/types'
import { api } from '@/lib/api'
import { relativeLabel, topicLabel } from '@/lib/format'
import { rememberUser } from '@/lib/remember'
import { topicHref } from '@/lib/route'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TopicClaudeDialog } from '@/components/DocDialog'
import { SummaryDialog } from '@/components/SummaryDialog'
import { NewTopicDialog } from '@/components/NewTopicDialog'
import { UserDocsDialog } from '@/components/UserDocsDialog'

export default function TopicListPage() {
  const { user = '' } = useParams()
  const navigate = useNavigate()
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [summaryFor, setSummaryFor] = useState<TopicRef | null>(null)
  const [claudeFor, setClaudeFor] = useState<TopicRef | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)

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

  /** 名前を決めずに始める。作ってそのままチャットへ移る。 */
  async function start(topic: string) {
    try {
      const child = await api.startChild(user, topic)
      navigate(topicHref(user, { topic, sub: child.slug }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '始められませんでした')
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))] backdrop-blur">
        <div>
          <h1 className="text-base font-semibold">{user}</h1>
          <p className="text-muted-foreground text-xs">トピック</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setDocsOpen(true)}>
            <Settings2 className="size-4" />
            設定
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            新しいトピックを追加
          </Button>
        </div>
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
            <li key={topic.slug} className="pt-1">
              <div className="flex items-center justify-between px-1 pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-base">{topic.emoji}</span>
                  <span className="min-w-0 truncate text-sm font-semibold">{topic.name}</span>
                </div>
                <div className="flex flex-wrap items-center">
                  <TopicButton
                    label="CLAUDE.md"
                    title={`${topic.name} の CLAUDE.md`}
                    onClick={() => setClaudeFor({ topic: topic.slug })}
                  >
                    <ScrollText className="size-3.5" />
                  </TopicButton>
                  <TopicButton
                    label="要約"
                    title={`${topic.name} の要約`}
                    onClick={() => setSummaryFor({ topic: topic.slug })}
                  >
                    <NotebookPen className="size-3.5" />
                  </TopicButton>
                  <TopicButton
                    label="チャットを始める"
                    variant="default"
                    title={`${topic.name} の中で新しくチャットを始める`}
                    onClick={() => start(topic.slug)}
                  >
                    <Plus className="size-3.5" />
                  </TopicButton>
                </div>
              </div>

              {topic.children.length === 0 ? (
                <p className="text-muted-foreground ml-3 border-l pl-3 text-xs">
                  まだ中に何もないよ。「話す」を押すとすぐ話し始められる。
                </p>
              ) : (
                <ul className="ml-3 flex flex-col gap-1.5 border-l pl-3">
                  {topic.children.map((child) => (
                    <TopicCard
                      key={child.slug}
                      topic={child}
                      href={topicHref(user, { topic: topic.slug, sub: child.slug })}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </main>

      <NewTopicDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={async (input) => {
          await api.createTopic(user, input)
          load()
        }}
      />

      <SummaryDialog
        user={user}
        target={summaryFor}
        open={summaryFor !== null}
        onOpenChange={(open) => !open && setSummaryFor(null)}
      />

      <TopicClaudeDialog
        user={user}
        target={claudeFor}
        open={claudeFor !== null}
        onOpenChange={(open) => !open && setClaudeFor(null)}
      />

      <UserDocsDialog user={user} open={docsOpen} onOpenChange={setDocsOpen} />
    </div>
  )
}

function TopicButton({
  label,
  title,
  onClick,
  children,
  variant = 'ghost',
}: {
  label: string
  title: string
  variant?: 'default' | 'outline' | 'secondary' | 'ghost'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      title={title}
      onClick={onClick}
      className={cn('text-muted-foreground shrink-0', variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/80')}
    >
      {children}
      {label}
    </Button>
  )
}

function TopicCard({ topic, href }: { topic: Topic; href: string }) {
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
            <span
              className={cn(
                'truncate text-[15px] font-medium',
                topic.name || 'text-muted-foreground',
              )}
            >
              {topicLabel(topic)}
            </span>
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
  )
}
