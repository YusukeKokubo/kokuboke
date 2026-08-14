import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { TopicRef } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Status = 'loading' | 'idle' | 'saving'

/**
 * 親が毎回作り直した TopicRef を、中身が同じなら同じものとして扱う。
 * 挟まないと描画のたびに読み直しが走る。
 */
export function useStableRef(target: TopicRef | null): TopicRef | null {
  const topic = target?.topic
  const sub = target?.kind === 'child' ? target.sub : undefined
  return useMemo(() => {
    if (!topic) return null
    return sub === undefined ? { kind: 'group', topic } : { kind: 'child', topic, sub }
  }, [topic, sub])
}

export function useDoc(open: boolean, source: string, load: () => Promise<string>) {
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setStatus('loading')
    setNotice(null)

    loadRef
      .current()
      .then((text) => {
        if (cancelled) return
        setSaved(text)
        setDraft(text)
        setStatus('idle')
      })
      .catch((cause: Error) => {
        if (cancelled) return
        setNotice(cause.message)
        setStatus('idle')
      })

    return () => {
      cancelled = true
    }
  }, [open, source])

  const dirty = draft !== saved
  const busy = status === 'saving'

  async function save(write: (text: string) => Promise<string>) {
    if (busy) return false
    setStatus('saving')
    try {
      const next = await write(draft)
      setSaved(next)
      setDraft(next)
      setNotice(null)
      return true
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '保存できませんでした')
      return false
    } finally {
      setStatus('idle')
    }
  }

  return { saved, draft, setDraft, status, notice, setNotice, dirty, busy, save }
}

interface EditorProps {
  doc: ReturnType<typeof useDoc>
  placeholder?: string
  /** 外の仕事で塞がっているとき（要約の下書き生成中など）。 */
  busy?: boolean
  /** 保存ボタン列の上に差し込むもの。 */
  actions?: ReactNode
  onSave: () => void
}

export function DocEditor({ doc, placeholder, busy: externalBusy, actions, onSave }: EditorProps) {
  const { draft, setDraft, status, notice, dirty } = doc
  const busy = doc.busy || !!externalBusy

  return (
    <>
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
          placeholder={placeholder}
          className="max-h-[45dvh] min-h-40 overflow-y-auto font-mono text-[13px] leading-relaxed"
        />
      )}

      {notice && <p className="text-muted-foreground text-xs">{notice}</p>}

      {actions && <div className="flex min-w-0 items-center gap-1">{actions}</div>}

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDraft(doc.saved)}
            disabled={busy}
          >
            元に戻す
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={busy || !dirty || status === 'loading'}
        >
          {status === 'saving' && <Loader2 className="size-4 animate-spin" />}
          保存
        </Button>
      </div>
    </>
  )
}
