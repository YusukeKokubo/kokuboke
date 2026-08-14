import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import type { Topic } from '../../shared/types'
import { relativeLabel, topicLabel } from '@/lib/format'
import { useSpace } from '@/lib/space'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FamilyEntry } from '@/components/FamilyEntry'

export default function TopicListPage() {
  const space = useSpace()
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Topic | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(() => {
    space.api
      .listTopics()
      .then((list) => {
        space.confirm()
        setTopics(list)
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
      await space.api.deleteTopic(deleting.slug)
      setDeleting(null)
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? space.busyNotice(cause.message) : '削除できませんでした',
      )
    } finally {
      setDeleteBusy(false)
      load()
    }
  }

  return (
    <>
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
            まだ会話がないよ。
            <br />
            {space.emptyHint}
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          {topics?.map((topic) => (
            <li key={topic.slug} className="flex items-center gap-1">
              <div className="min-w-0 flex-1 rounded-xl border">
                <Link
                  to={space.href(topic.slug)}
                  className="hover:bg-accent active:bg-accent flex items-center gap-3 rounded-xl p-3 transition-colors"
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
                {topic.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 pb-3 pl-[4.25rem]">
                    {topic.tags.map((tag) => (
                      <Link
                        key={tag}
                        to={space.tagHref(tag)}
                        className="bg-secondary text-muted-foreground hover:bg-accent rounded-full px-2 py-0.5 text-[11px]"
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title={`${topicLabel(topic)} を削除する`}
                onClick={() => {
                  setDeleteError(null)
                  setDeleting(topic)
                }}
                className="text-muted-foreground shrink-0"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </main>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (open || deleteBusy) return
          setDeleting(null)
          setDeleteError(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>会話を削除する</DialogTitle>
            <DialogDescription>
              {deleting ? `「${topicLabel(deleting)}」を削除します。元に戻せません。` : ''}
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
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
