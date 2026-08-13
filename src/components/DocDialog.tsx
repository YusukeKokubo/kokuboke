import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { TopicRef } from '../../shared/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Status = 'loading' | 'idle' | 'saving'

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

  return { saved, draft, setDraft, status, notice, dirty, busy, save }
}

interface EditorProps {
  doc: ReturnType<typeof useDoc>
  placeholder?: string
  onSave: () => void
}

export function DocEditor({ doc, placeholder, onSave }: EditorProps) {
  const { draft, setDraft, status, notice, dirty, busy } = doc

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

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  placeholder?: string
  source: string
  load: () => Promise<string>
  save: (text: string) => Promise<string>
}

/**
 * Markdown 文書の確認と編集。保存を押すまでファイルは変わらない。
 */
export function DocDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  source,
  load,
  save,
}: DialogProps) {
  const doc = useDoc(open, source, load)

  async function handleSave() {
    if (await doc.save(save)) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !doc.busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DocEditor doc={doc} placeholder={placeholder} onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}

interface TopicClaudeProps {
  user: string
  /** どのトピックの振る舞いか。閉じている間は null になりうる。 */
  target: TopicRef | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** トピックの CLAUDE.md。器でも子でも同じ口。 */
export function TopicClaudeDialog({ user, target, open, onOpenChange }: TopicClaudeProps) {
  const topic = target?.topic
  const sub = target?.sub
  const ref = useMemo(() => (topic ? { topic, sub } : null), [topic, sub])

  const load = useCallback(
    () => (ref ? api.getTopicClaude(user, ref).then((doc) => doc.claude) : Promise.resolve('')),
    [user, ref],
  )

  const save = useCallback(
    async (text: string) => {
      if (!ref) return text
      return (await api.saveTopicClaude(user, ref, text)).claude
    },
    [user, ref],
  )

  return (
    <DocDialog
      open={open && ref !== null}
      onOpenChange={onOpenChange}
      title="CLAUDE.md"
      description={
        sub
          ? 'この話での役割。上の話題の設定も一緒に読まれるよ。'
          : 'この話題での役割。上の CLAUDE.md も一緒に読まれるよ。'
      }
      placeholder="まだ書いていないよ。"
      source={`${user}:${topic ?? ''}:${sub ?? ''}`}
      load={load}
      save={save}
    />
  )
}
