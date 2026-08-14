import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { Tag, Topic } from '../../shared/types'
import { relativeLabel, topicLabel } from '@/lib/format'
import { useSpace } from '@/lib/space'
import { Button } from '@/components/ui/button'
import { SpaceHeaderSlot } from '@/components/SpaceHeader'
import { Input } from '@/components/ui/input'
import { DocPane } from '@/components/DocsDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [creating, setCreating] = useState('')
  const [busy, setBusy] = useState(false)
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

  async function create() {
    const name = creating.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await space.api.createTag({ name })
      navigate(space.tagHref(created.name))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作れませんでした')
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-3 py-3">
      <SpaceHeaderSlot>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{space.tagsTitle}</h1>
          <p className="text-muted-foreground text-xs">
            付いているタグの本文は、話すたびに読み込まれるよ
          </p>
        </div>
      </SpaceHeaderSlot>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <Input
          value={creating}
          onChange={(event) => setCreating(event.target.value)}
          placeholder="新しいタグ"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !creating.trim()}>
          <Plus className="size-4" />
          作る
        </Button>
      </form>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {tags === null && <p className="text-muted-foreground py-8 text-center text-sm">読み込み中…</p>}

      {tags?.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">まだタグがないよ。上から作れる。</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {tags?.map((item) => (
          <li key={item.name}>
            <Link
              to={space.tagHref(item.name)}
              className="hover:bg-accent active:bg-accent flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{item.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {item.text.trim() ? item.text.replace(/\s+/g, ' ').slice(0, 60) : 'まだ何も覚えていないよ'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

function TagDoc({ name }: { name: string }) {
  const space = useSpace()
  const navigate = useNavigate()
  const [exists, setExists] = useState<boolean | null>(null)
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [renaming, setRenaming] = useState(name)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([space.api.getTag(name), space.api.listTopics()])
      .then(([, list]) => {
        if (cancelled) return
        space.confirm()
        setExists(true)
        setTopics(list.filter((topic) => topic.tags.includes(name)))
        setError(null)
      })
      .catch((cause: Error) => {
        if (cancelled) return
        setExists(false)
        setTopics(null)
        setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [space, name])

  async function rename() {
    const next = renaming.trim()
    if (!next || busy) return
    setBusy(true)
    setError(null)
    try {
      const tag = await space.api.renameTag(name, next)
      setRenameOpen(false)
      navigate(space.tagHref(tag.name), { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '名前を変えられませんでした')
    } finally {
      setBusy(false)
    }
  }

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
            <h1 className="truncate text-base font-semibold">{name}</h1>
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
                onClick={() => {
                  setRenaming(name)
                  setRenameOpen(true)
                }}
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
                load: () => space.api.getTag(name),
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
                      <span className="bg-secondary flex size-11 shrink-0 items-center justify-center rounded-full text-xl">
                        {topic.emoji}
                      </span>
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

      <Dialog open={renameOpen} onOpenChange={(next) => !busy && setRenameOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>タグの名前を変える</DialogTitle>
            <DialogDescription>付いている会話も、一緒に付け替えるよ。</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void rename()
            }}
          >
            <Input
              value={renaming}
              onChange={(event) => setRenaming(event.target.value)}
              disabled={busy}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)} disabled={busy}>
                キャンセル
              </Button>
              <Button type="submit" disabled={busy || !renaming.trim()}>
                変える
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={(next) => !busy && setDeleting(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>タグを削除する</DialogTitle>
            <DialogDescription>
              「{name}」を消します。会話からは外れるよ。元に戻せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(false)} disabled={busy}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
