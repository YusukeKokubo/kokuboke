import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { TopicRef } from '../../shared/types'
import { api, draftSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ModelPicker, type ModelSelection } from '@/components/ModelPicker'
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

type Status = 'loading' | 'idle' | 'drafting' | 'saving'

/**
 * 要約（summary.md）の確認と編集。AI に整理させても、保存を押すまでファイルは変わらない。
 */
export function SummaryDialog({ user, target, open, onOpenChange }: Props) {
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [choice, setChoice] = useState<ModelSelection | null>(null)

  const abort = useRef<AbortController | null>(null)

  // 依存に置くのは中身。親が毎回作り直したオブジェクトでも読み直さない。
  const topic = target?.topic
  const sub = target?.sub
  const ref = useMemo(() => (topic ? { topic, sub } : null), [topic, sub])

  useEffect(() => {
    if (!open || !ref) return

    let cancelled = false
    setStatus('loading')
    setNotice(null)

    api
      .getSummary(user, ref)
      .then((summary) => {
        if (cancelled) return
        setSaved(summary.summary)
        setDraft(summary.summary)
        setStatus('idle')
      })
      .catch((cause: Error) => {
        if (cancelled) return
        setNotice(cause.message)
        setStatus('idle')
      })

    return () => {
      cancelled = true
      abort.current?.abort()
    }
  }, [open, user, ref])

  const dirty = draft !== saved
  const busy = status === 'drafting' || status === 'saving'

  async function handleDraft() {
    if (busy || !ref) return
    setStatus('drafting')
    setNotice(null)

    const controller = new AbortController()
    abort.current = controller

    try {
      let text = ''
      for await (const event of draftSummary(user, ref, choice, controller.signal)) {
        if (event.type === 'delta') {
          text += event.text
          setDraft(text)
        }
        if (event.type === 'done') {
          setDraft(event.text)
          setNotice(`${event.modelLabel} が下書きしたよ。よければ保存してね。`)
        }
        if (event.type === 'error') setNotice(event.message)
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setNotice(cause instanceof Error ? cause.message : '要約を整理できませんでした')
      }
    } finally {
      abort.current = null
      setStatus('idle')
    }
  }

  async function handleSave() {
    if (busy || !ref) return
    setStatus('saving')
    try {
      const summary = await api.saveSummary(user, ref, draft)
      setSaved(summary.summary)
      setDraft(summary.summary)
      onOpenChange(false)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '保存できませんでした')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>要約</DialogTitle>
          <DialogDescription>
            会話のたびに読み込まれる覚え書き。そのまま直してもいいし、AI に整理させてもいいよ。
          </DialogDescription>
        </DialogHeader>

        {status === 'loading' ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" />
            読み込んでいるよ
          </div>
        ) : (
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            readOnly={busy}
            rows={12}
            placeholder="まだ何も覚えていないよ。"
            className="max-h-[45dvh] min-h-40 overflow-y-auto font-mono text-[13px] leading-relaxed"
          />
        )}

        {notice && <p className="text-muted-foreground text-xs">{notice}</p>}

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

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleDraft}
            disabled={busy || status === 'loading'}
          >
            {status === 'drafting' ? (
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
        </div>

        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(saved)}
              disabled={busy}
            >
              元に戻す
            </Button>
          )}

          <Button type="button" size="sm" onClick={handleSave} disabled={busy || !dirty}>
            {status === 'saving' && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
