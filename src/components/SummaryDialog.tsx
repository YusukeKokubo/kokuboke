import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { TopicRef } from '../../shared/types'
import { api, draftSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ModelPicker, type ModelSelection } from '@/components/ModelPicker'
import { DocEditor, useDoc } from '@/components/DocDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  user: string
  /** どのトピックの要約か。閉じている間は null になりうる。 */
  target: TopicRef | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 要約（summary.md）の確認と編集。AI に整理させても、保存を押すまでファイルは変わらない。
 */
export function SummaryDialog({ user, target, open, onOpenChange }: Props) {
  const [drafting, setDrafting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [choice, setChoice] = useState<ModelSelection | null>(null)
  const abort = useRef<AbortController | null>(null)

  // 依存に置くのは中身。親が毎回作り直したオブジェクトでも読み直さない。
  const topic = target?.topic
  const sub = target?.kind === 'child' ? target.sub : undefined
  const ref = useMemo((): TopicRef | null => {
    if (!topic) return null
    return sub === undefined
      ? { kind: 'group', topic }
      : { kind: 'child', topic, sub }
  }, [topic, sub])

  const load = useCallback(
    () => (ref ? api.getSummary(user, ref) : Promise.resolve('')),
    [user, ref],
  )

  const doc = useDoc(open && ref !== null, `${user}:${topic ?? ''}:${sub ?? ''}`, load)

  useEffect(() => {
    if (!open) abort.current?.abort()
  }, [open])

  const busy = drafting || doc.busy

  async function handleDraft() {
    if (busy || !ref || doc.status === 'loading') return
    setDrafting(true)
    doc.setNotice(null)

    const controller = new AbortController()
    abort.current = controller

    try {
      let text = ''
      for await (const event of draftSummary(user, ref, choice, controller.signal)) {
        if (event.type === 'delta') {
          text += event.text
          doc.setDraft(text)
        }
        // 要約は会話より時間がかかる。何をしているかは知らせ書きの場所を借りて出す。
        // 下書きの本文が流れ始めれば、そちらが進んでいるのが見えるので上書きしない。
        if (event.type === 'activity' && !text) doc.setNotice(event.label)
        if (event.type === 'done') {
          doc.setDraft(event.text)
          doc.setNotice(`${event.modelLabel} が下書きしたよ。よければ保存してね。`)
        }
        if (event.type === 'error') doc.setNotice(event.message)
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        doc.setNotice(cause instanceof Error ? cause.message : '要約を整理できませんでした')
      }
    } finally {
      abort.current = null
      setDrafting(false)
    }
  }

  async function handleSave() {
    if (!ref) return
    if (await doc.save((text) => api.saveSummary(user, ref, text))) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>要約</DialogTitle>
          <DialogDescription>
            {sub
              ? '会話のたびに読み込まれる覚え書き。そのまま直してもいいし、AI に整理させてもいいよ。'
              : '中のどれで話しても効く共有の覚え書き。そのまま直してもいいし、AI に整理させてもいいよ。'}
          </DialogDescription>
        </DialogHeader>

        {pickerOpen && (
          <div className="rounded-md border p-3">
            <ModelPicker
              value={choice}
              onChange={(next) => {
                setChoice(next)
                setPickerOpen(false)
              }}
            />
          </div>
        )}

        <DocEditor
          doc={doc}
          placeholder="まだ何も覚えていないよ。"
          busy={drafting}
          onSave={handleSave}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleDraft}
                disabled={busy || doc.status === 'loading'}
              >
                {drafting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                AI に整理させる
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPickerOpen((v) => !v)}
                disabled={busy}
                className="text-muted-foreground min-w-0 text-xs"
              >
                <span className="truncate">{choice?.label ?? 'モデルは既定のまま'}</span>
              </Button>
            </>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
