import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Tag, Topic } from '../../shared/types'
import { relativeLabel, topicLabel } from '@/lib/format'
import { useSpace } from '@/lib/space'
import { useDocumentTitle } from '@/lib/title'
import { Button } from '@/components/ui/button'
import { SpaceHeaderSlot } from '@/components/SpaceHeader'
import { EmojiNameDialog } from '@/components/EmojiNameDialog'
import { DocPane } from '@/components/DocsDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * タグの一覧と、一つのタグ本文。個人と家族で同じ画面。
 * 本文は `/tags/:tag`。ファイルは各スペースの `tags/{tag}.md`。
 */
export default function TagsPage() {
  const { tag: raw } = useParams()
  const tag = raw ? raw.replace(/\.md$/i, '') : null
  return tag ? <TagDoc name={tag} /> : <TagList />
}

function TagList() {
  const space = useSpace()
  const navigate = useNavigate()
  useDocumentTitle(space.tagsTitle)
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<Tag | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    space.api
      .listTags()
      .then((list) => {
        space.confirm()
        setTags(list)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [space])

  useEffect(load, [load])

  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await space.api.deleteTag(deleting.name)
      setDeleting(null)
      load()
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '削除できませんでした')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-3 py-3">
      <SpaceHeaderSlot>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{space.tagsTitle}</h1>
            <p className="text-muted-foreground text-xs">
              付いているタグの本文は、話すたびに読み込まれるよ
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            作る
          </Button>
        </div>
      </SpaceHeaderSlot>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {tags === null && <p className="text-muted-foreground py-8 text-center text-sm">読み込み中…</p>}

      {tags?.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">まだタグがないよ。上から作れる。</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {tags?.map((item) => (
          <li key={item.name} className="flex min-w-0 items-stretch rounded-xl border">
            <Link
              to={space.tagHref(item.name)}
              className="hover:bg-accent active:bg-accent flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3 transition-colors"
            >
              <span className="bg-secondary flex size-11 shrink-0 items-center justify-center rounded-full text-xl">
                {item.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{item.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {item.text.trim() ? item.text.replace(/\s+/g, ' ').slice(0, 60) : 'まだ何も覚えていないよ'}
                </span>
              </span>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="ghost" size="icon-sm" className="mr-2 self-center" />}
              >
                <MoreHorizontal />
                <span className="sr-only">{item.name} の操作</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      setDeleteError(null)
                      setDeleting(item)
                    }}
                  >
                    <Trash2 />
                    削除
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      <EmojiNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="タグを作る"
        description="会話に付けて、覚え書きを残せるよ。"
        submitLabel="作る"
        placeholder="例: 秋の旅行"
        onSubmit={async ({ name, emoji }) => {
          const created = await space.api.createTag({ name, emoji })
          navigate(space.tagHref(created.name))
        }}
      />

      <TagDeleteDialog
        name={deleting?.name ?? null}
        open={deleting !== null}
        busy={deleteBusy}
        error={deleteError}
        onOpenChange={(open) => {
          if (open || deleteBusy) return
          setDeleting(null)
          setDeleteError(null)
        }}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  )
}

function TagDoc({ name }: { name: string }) {
  const space = useSpace()
  const navigate = useNavigate()
  const [tag, setTag] = useState<Tag | null>(null)
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const exists = tag !== null ? true : topics === null && error === null ? null : false
  useDocumentTitle(tag ? `${tag.emoji} ${tag.name}` : name)

  useEffect(() => {
    let cancelled = false
    setTag(null)
    setTopics(null)
    setError(null)
    Promise.all([space.api.getTag(name), space.api.listTopics()])
      .then(([current, list]) => {
        if (cancelled) return
        space.confirm()
        setTag(current)
        setTopics(list.filter((topic) => topic.tags.includes(name)))
        setError(null)
      })
      .catch((cause: Error) => {
        if (cancelled) return
        setTag(null)
        setTopics(null)
        setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [space, name])

  async function remove() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await space.api.deleteTag(name)
      navigate(space.tags, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '削除できませんでした')
      setBusy(false)
    }
  }

  return (
    <>
      <SpaceHeaderSlot>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">
              {tag ? `${tag.emoji} ${tag.name}` : name}
            </h1>
            <p className="text-muted-foreground truncate text-xs">
              {topics === null ? space.tagsTitle : `${space.tagsTitle} · 会話 ${topics.length} 件`}
            </p>
          </div>
          {exists && (
            <div className="flex shrink-0 items-center">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setRenameOpen(true)}
              >
                <Pencil className="size-3.5" />
                改名
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(true)}>
                <Trash2 className="size-3.5" />
                削除
              </Button>
            </div>
          )}
        </div>
      </SpaceHeaderSlot>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-3 py-3">
        {error && <p className="text-destructive text-sm">{error}</p>}

        {exists === null && <p className="text-muted-foreground py-8 text-center text-sm">読み込み中…</p>}

        {exists && (
          <>
            <DocPane
              spec={{
                label: name,
                description: '',
                placeholder: 'まだ何も覚えていないよ。',
                load: () => space.api.getTag(name).then((current) => current.text),
                save: (text) => space.api.saveTag(name, text),
                draft: (signal) => space.api.draftTag(name, signal),
              }}
              open
              source={`${space.docKey()}:tag:${name}`}
              active
              onBusy={setBusy}
              onSaved={() => {}}
            />

            <section className="flex flex-col gap-1.5 pt-2">
              <h2 className="text-muted-foreground px-1 text-xs font-medium">このタグの会話</h2>
              {topics?.length === 0 && (
                <p className="text-muted-foreground px-1 py-4 text-sm">まだ付いている会話はないよ。</p>
              )}
              <ul className="flex flex-col gap-1.5">
                {topics?.map((topic) => (
                  <li key={topic.slug}>
                    <Link
                      to={space.href(topic.slug)}
                      className="hover:bg-accent active:bg-accent flex items-center gap-3 rounded-xl border p-3 transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-[15px] font-medium ${topic.name ? '' : 'text-muted-foreground'}`}
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
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      <EmojiNameDialog
        open={renameOpen}
        onOpenChange={(next) => !busy && setRenameOpen(next)}
        title="タグの名前を変える"
        description="付いている会話も、一緒に付け替えるよ。"
        submitLabel="変える"
        placeholder="例: 秋の旅行"
        initial={tag ? { name: tag.name, emoji: tag.emoji } : undefined}
        onSubmit={async ({ name: next, emoji }) => {
          const renamed = await space.api.renameTag(name, { name: next, emoji })
          setRenameOpen(false)
          navigate(space.tagHref(renamed.name), { replace: true })
        }}
      />

      <TagDeleteDialog
        name={name}
        open={deleting}
        busy={busy}
        error={error}
        onOpenChange={(open) => {
          if (open || busy) return
          setDeleting(false)
        }}
        onConfirm={() => void remove()}
      />
    </>
  )
}

function TagDeleteDialog({
  name,
  open,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: {
  name: string | null
  open: boolean
  busy: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>タグを削除する</DialogTitle>
          <DialogDescription>
            {name ? `「${name}」を消します。会話からは外れるよ。元に戻せません。` : ''}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            キャンセル
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            削除する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
