import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, NotebookPen, ScrollText } from 'lucide-react'
import type { Topic } from '../../shared/types'
import { familyApi } from '@/lib/api'
import { topicLabel } from '@/lib/format'
import { familyTopicHref } from '@/lib/route'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { TopicClaudeDialog } from '@/components/DocDialog'
import { SummaryDialog } from '@/components/SummaryDialog'

export default function FamilyGroupPage() {
  const { topic = '' } = useParams()
  const ref = useMemo(() => ({ kind: 'group' as const, topic }), [topic])

  const [meta, setMeta] = useState<Topic | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [claudeOpen, setClaudeOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    familyApi
      .getTopic(ref)
      .then((topicMeta) => {
        if (cancelled) return
        setMeta(topicMeta)
      })
      .catch((cause: Error) => !cancelled && setNotice(cause.message))
    return () => {
      cancelled = true
    }
  }, [ref])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex flex-col gap-2 border-b px-2 py-2 pt-[calc(0.5rem+var(--safe-top))] backdrop-blur">
        <div className="flex items-center gap-2">
          <Link
            to="/family"
            aria-label="トピック一覧に戻る"
            className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-9 shrink-0' })}
          >
            <ChevronLeft className="size-5" />
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold">
              {meta ? `${meta.emoji} ${meta.name}` : '…'}
            </h1>
          </div>

          <Button size="sm" variant="ghost" onClick={() => setClaudeOpen(true)} className="shrink-0">
            <ScrollText className="size-4" />
            CLAUDE.md
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSummaryOpen(true)} className="shrink-0">
            <NotebookPen className="size-4" />
            要約
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-3 py-4">
        <div className="flex flex-col gap-2 py-6">
          <p className="text-muted-foreground text-center text-sm">
            {meta?.kind === 'group' && meta.children.length === 0
              ? 'まだ中に何もないよ。一覧の「話す」から始められるよ。'
              : 'このトピックの中から、どれで話すか選んでね。'}
          </p>
          {meta?.kind === 'group' &&
            meta.children.map((child) => (
              <Link
                key={child.slug}
                to={familyTopicHref({ kind: 'child', topic, sub: child.slug })}
                className="hover:bg-accent flex items-center gap-3 rounded-xl border p-3"
              >
                <span className="text-xl">{child.emoji}</span>
                <span
                  className={cn(
                    'truncate text-[15px] font-medium',
                    child.name || 'text-muted-foreground',
                  )}
                >
                  {topicLabel(child)}
                </span>
              </Link>
            ))}
        </div>

        {notice && (
          <p className="text-muted-foreground bg-secondary mx-auto rounded-full px-3 py-1.5 text-center text-xs">
            {notice}
          </p>
        )}
      </main>

      <SummaryDialog
        user="family"
        family
        target={ref}
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
      />

      <TopicClaudeDialog
        user="family"
        family
        target={ref}
        open={claudeOpen}
        onOpenChange={setClaudeOpen}
      />
    </div>
  )
}
