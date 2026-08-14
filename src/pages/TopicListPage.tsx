import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, NotebookPen, Plus, Settings2, Trash2 } from 'lucide-react'
import type { ChildTopic, GroupTopic, TopicRef } from '../../shared/types'
import { relativeLabel, topicLabel } from '@/lib/format'
import { personalHome, useSpace } from '@/lib/space'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SpaceDocsDialog, TopicDocsDialog } from '@/components/DocsDialog'
import { EmojiNameDialog } from '@/components/EmojiNameDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FamilyEntry } from '@/components/FamilyEntry'

type DeleteTarget =
  | { kind: 'group'; topic: GroupTopic }
  | { kind: 'child'; groupName: string; topic: ChildTopic }

export default function TopicListPage() {
  const space = useSpace()
  const navigate = useNavigate()
  const [topics, setTopics] = useState<GroupTopic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [docFor, setDocFor] = useState<{ ref: TopicRef; tab: 'summary' | 'claude' } | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(() => {
    space.api
      .listTopics()
      .then((list) => {
        // ここまで来た名前だけを端末に残す。存在しない名前は 404 で弾かれる。
        space.confirm()
        setTopics(list)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [space])

  useEffect(load, [load])

  /** 名前を決めずに始める。作ってそのままチャットへ移る。 */
  async function start(topic: string) {
    try {
      const child = await space.api.startChild(topic)
      navigate(space.href({ kind: 'child', topic, sub: child.slug }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '始められませんでした')
    }
  }

  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      if (deleting.kind === 'group') {
        await space.api.deleteTopic({ kind: 'group', topic: deleting.topic.slug })
      } else {
        await space.api.deleteTopic({
          kind: 'child',
          topic: deleting.groupName,
          sub: deleting.topic.slug,
        })
      }
      setDeleting(null)
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? space.busyNotice(cause.message) : '削除できませんでした',
      )
    } finally {
      setDeleteBusy(false)
      // 失敗のときも読み直す。別の端末で先に消されていた場合、
      // 一覧に古い行が残ったままになる。
      load()
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex flex-col gap-2 border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{space.title}</h1>
            <p className="text-muted-foreground text-xs">{space.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDocsOpen(true)}>
              <Settings2 className="size-4" />
              設定
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              追加
            </Button>
          </div>
        </div>

        {/* 共有スペースからは自分のところへ戻る道を出す。個人側は下の入口から入る。 */}
        {space.kind === 'family' && space.author && (
          <div className="flex items-center justify-end gap-2">
            <Link
              to={personalHome(space.author)}
              className="text-muted-foreground text-xs underline-offset-2 hover:underline"
            >
              自分のトピックへ
            </Link>
          </div>
        )}
      </header>

      <main className="flex-1 px-3 py-3">
        {space.kind === 'personal' && (
          <div className="mb-3">
            <FamilyEntry />
          </div>
        )}

        {error && <p className="text-destructive px-1 py-8 text-center text-sm">{error}</p>}

        {!error && topics === null && (
          <p className="text-muted-foreground px-1 py-8 text-center text-sm">読み込み中…</p>
        )}

        {topics?.length === 0 && (
          <div className="text-muted-foreground px-6 py-16 text-center text-sm leading-relaxed">
            まだトピックがないよ。
            <br />
            {space.emptyHint}
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
                    label="要約"
                    title={`${topic.name} の要約`}
                    onClick={() =>
                      setDocFor({ ref: { kind: 'group', topic: topic.slug }, tab: 'summary' })
                    }
                  >
                    <NotebookPen className="size-3.5" />
                  </TopicButton>
                  <TopicButton
                    label="CLAUDE.md"
                    title={`${topic.name} の CLAUDE.md`}
                    onClick={() =>
                      setDocFor({ ref: { kind: 'group', topic: topic.slug }, tab: 'claude' })
                    }
                  >
                    <Bot className="size-3.5" />
                  </TopicButton>
                  <TopicButton
                    label="話す"
                    variant="default"
                    title={`${topic.name} の中で新しくチャットを始める`}
                    onClick={() => start(topic.slug)}
                  >
                    <Plus className="size-3.5" />
                  </TopicButton>
                  <TopicButton
                    title={`${topic.name} を削除する`}
                    onClick={() => {
                      setDeleteError(null)
                      setDeleting({ kind: 'group', topic })
                    }}
                  >
                    <Trash2 className="size-3.5" />
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
                      href={space.href({ kind: 'child', topic: topic.slug, sub: child.slug })}
                      onDelete={() => {
                        setDeleteError(null)
                        setDeleting({ kind: 'child', groupName: topic.slug, topic: child })
                      }}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </main>

      <EmojiNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="新しいトピック"
        description="ここは要約の置き場だよ。話しかけるのは、この中に作ったトピック。"
        submitLabel="作る"
        placeholder="例: 数学学習"
        onSubmit={async ({ name, emoji }) => {
          await space.api.createTopic({ name, emoji, engine: '', model: '' })
          load()
        }}
      />

      <TopicDocsDialog
        target={docFor?.ref ?? null}
        tab={docFor?.tab ?? 'summary'}
        open={docFor !== null}
        onOpenChange={(open) => !open && setDocFor(null)}
      />

      <SpaceDocsDialog open={docsOpen} onOpenChange={setDocsOpen} />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          // 消している最中に閉じられると、失敗したときの知らせ先が無くなる。
          if (open || deleteBusy) return
          setDeleting(null)
          setDeleteError(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>トピックを削除する</DialogTitle>
            <DialogDescription>
              {deleting?.kind === 'group'
                ? `「${deleting.topic.name}」を削除します。中のチャット ${deleting.topic.children.length} 件も一緒に削除され、元に戻せません。`
                : deleting?.kind === 'child'
                  ? `「${topicLabel(deleting.topic)}」を削除します。元に戻せません。`
                  : ''}
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-destructive text-sm">{deleteError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleting(null)
                setDeleteError(null)
              }}
              disabled={deleteBusy}
            >
              キャンセル
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  /** 無ければ絵札だけ。横が詰まる並びで使う。 */
  label?: string
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

function TopicCard({ topic, href, onDelete }: { topic: ChildTopic; href: string; onDelete: () => void }) {
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={`${topicLabel(topic)} を削除する`}
        onClick={onDelete}
        className="text-muted-foreground shrink-0"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  )
}
