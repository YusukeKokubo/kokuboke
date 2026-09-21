import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ListTree, Loader2, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { organizeActionKey, type Tag, type TagOrganizeAction, type Topic } from '../../shared/types'
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
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [deleting, setDeleting] = useState<Tag | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(
    () => [...new Set((tags ?? []).map((tag) => tag.group).filter(Boolean))],
    [tags],
  )
  const sections = useMemo(() => sectionTags(tags ?? []), [tags])

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
              大分類だけ。本文は、話すたびに読み込まれるよ
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              render={<Link to={space.organize} />}
              aria-label={space.organizeTitle}
              title={space.organizeTitle}
            >
              <ListTree />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!tags?.length}
              onClick={() => setOrganizeOpen(true)}
            >
              <Sparkles data-icon="inline-start" />
              整理する
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />
              作る
            </Button>
          </div>
        </div>
      </SpaceHeaderSlot>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {tags === null && <p className="text-muted-foreground py-8 text-center text-sm">読み込み中…</p>}

      {tags?.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">まだタグがないよ。上から作れる。</p>
      )}

      {sections.map((section) => (
        <section key={section.group || 'none'} className="flex flex-col gap-1.5">
          <h2 className="text-muted-foreground px-1 text-xs font-medium">
            {section.group || '棚なし'}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {section.tags.map((item) => (
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
        </section>
      ))}

      <EmojiNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="タグを作る"
        description="名前だけでよいよ。棚はあとから整理できる。"
        submitLabel="作る"
        placeholder="例: 美術館博物館巡り"
        groups={groups}
        onSubmit={async ({ name, emoji, group }) => {
          const created = await space.api.createTag({ name, emoji, group })
          navigate(space.tagHref(created.name))
        }}
      />

      <OrganizeDialog
        open={organizeOpen}
        onOpenChange={setOrganizeOpen}
        onApplied={load}
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
  const [groups, setGroups] = useState<string[]>([])
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
    Promise.all([space.api.getTag(name), space.api.listTopics(), space.api.listTags()])
      .then(([current, list, all]) => {
        if (cancelled) return
        space.confirm()
        setTag(current)
        setTopics(list.filter((topic) => topic.tags.includes(name)))
        setGroups([...new Set(all.map((item) => item.group).filter(Boolean))])
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
              {tag?.group ? `${tag.group} · ` : ''}
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
            <p className="text-muted-foreground text-xs">
              このタグの話をするときの指示。AGENTS.md と同じように毎回 AI に渡る。
            </p>
            <DocPane
              spec={{
                label: name,
                description: 'このタグの話をするときの指示。AGENTS.md と同じように毎回 AI に渡る。',
                placeholder: 'まだ指示がないよ。手で書くか、AI に会話から起こさせる。',
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
        initial={tag ? { name: tag.name, emoji: tag.emoji, group: tag.group } : undefined}
        groups={groups}
        onSubmit={async ({ name: next, emoji, group }) => {
          const renamed = await space.api.renameTag(name, { name: next, emoji, group })
          setTag(renamed)
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

function sectionTags(tags: Tag[]): { group: string; tags: Tag[] }[] {
  const sections: { group: string; tags: Tag[] }[] = []
  for (const tag of tags) {
    const last = sections.at(-1)
    if (last && last.group === tag.group) {
      last.tags.push(tag)
    } else {
      sections.push({ group: tag.group, tags: [tag] })
    }
  }
  return sections
}

function actionLabel(action: TagOrganizeAction): string {
  if (action.type === 'merge') return `「${action.from}」を「${action.to}」へ寄せる`
  if (action.type === 'shelf') return `「${action.name}」を棚「${action.group}」へ`
  return `「${action.name}」を消す`
}

function OrganizeDialog({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}) {
  const space = useSpace()
  const [activity, setActivity] = useState<string | null>(null)
  const [actions, setActions] = useState<TagOrganizeAction[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [drafting, setDrafting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) {
      abort.current?.abort()
      setActivity(null)
      setActions(null)
      setPicked(new Set())
      setDrafting(false)
      setApplying(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    abort.current = controller
    setDrafting(true)
    setError(null)
    setActions(null)
    setActivity('整理案を考えています…')

    void (async () => {
      try {
        for await (const event of space.api.organizeTags(controller.signal)) {
          if (event.type === 'activity') setActivity(event.label)
          if (event.type === 'error') setError(event.message)
          if (event.type === 'done') {
            setActions(event.actions)
            setPicked(new Set(event.actions.map(organizeActionKey)))
            setActivity(null)
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '整理案を作れませんでした')
        }
      } finally {
        if (!controller.signal.aborted) setDrafting(false)
      }
    })()

    return () => controller.abort()
  }, [open, space])

  async function apply() {
    if (!actions || applying) return
    const selected = actions.filter((action) => picked.has(organizeActionKey(action)))
    if (selected.length === 0) {
      onOpenChange(false)
      return
    }
    setApplying(true)
    setError(null)
    try {
      await space.api.applyOrganize(selected, actions)
      onOpenChange(false)
      onApplied()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '整理できませんでした')
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !applying && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>タグを整理する</DialogTitle>
          <DialogDescription>
            大分類と棚へ寄せる案です。残したい項目だけ選んで確定してね。
          </DialogDescription>
        </DialogHeader>

        {activity && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {activity}
          </p>
        )}

        {actions?.length === 0 && (
          <p className="text-muted-foreground text-sm">直すところはなさそうだよ。</p>
        )}

        {actions && actions.length > 0 && (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {actions.map((action) => {
              const key = organizeActionKey(action)
              const on = picked.has(key)
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked((current) => {
                        const next = new Set(current)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    }}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      on ? 'bg-accent' : 'text-muted-foreground'
                    }`}
                  >
                    {actionLabel(action)}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            キャンセル
          </Button>
          <Button type="button" onClick={() => void apply()} disabled={drafting || applying || actions === null}>
            確定する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
