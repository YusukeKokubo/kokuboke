import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { SummaryEvent } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { DocEditor, useDoc } from '@/components/DocEditor'

/**
 * 一枚の Markdown 文書。読み書きの口と、画面に出す文言だけを持つ。
 */
export interface DocSpec {
  /** 札と見出しに使う。 */
  label: string
  description: string
  placeholder: string
  load: () => Promise<string>
  save: (text: string) => Promise<string>
  /** AI に下書きさせられる文書だけ。いまはタグ本文だけ。 */
  draft?: (signal: AbortSignal) => AsyncGenerator<SummaryEvent>
}

/**
 * 札一枚分。読み込み・下書き・保存はここで完結する。隠れている間も生きたままで、
 * 書きかけを抱えている。`contents` なので、外の縦並びには直接ぶら下がる。
 */
export function DocPane({
  spec,
  open,
  source,
  active,
  onBusy,
  onSaved,
}: {
  spec: DocSpec
  open: boolean
  source: string
  active: boolean
  onBusy: (busy: boolean) => void
  onSaved: () => void
}) {
  const doc = useDoc(open, source, spec.load)
  const [drafting, setDrafting] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const busy = drafting || doc.busy

  useEffect(() => {
    if (active) onBusy(busy)
  }, [active, busy, onBusy])

  useEffect(() => {
    if (!open) abort.current?.abort()
  }, [open])

  async function handleDraft() {
    if (busy || !spec.draft || doc.status === 'loading') return
    setDrafting(true)
    doc.setNotice(null)

    const controller = new AbortController()
    abort.current = controller

    try {
      let text = ''
      for await (const event of spec.draft(controller.signal)) {
        if (event.type === 'delta') {
          text += event.text
          doc.setDraft(text)
        }
        if (event.type === 'activity' && !text) doc.setNotice(event.label)
        if (event.type === 'done') {
          doc.setDraft(event.text)
          doc.setNotice(`${event.modelLabel} が下書きしたよ。よければ保存してね。`)
        }
        if (event.type === 'error') doc.setNotice(event.message)
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        doc.setNotice(cause instanceof Error ? cause.message : '覚え書きを整理できませんでした')
      }
    } finally {
      abort.current = null
      setDrafting(false)
    }
  }

  return (
    <div className={active ? 'contents' : 'hidden'}>
      <DocEditor
        doc={doc}
        placeholder={spec.placeholder}
        busy={drafting}
        onSave={async () => {
          if (await doc.save(spec.save)) onSaved()
        }}
        actions={
          spec.draft && (
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
          )
        }
      />
    </div>
  )
}
