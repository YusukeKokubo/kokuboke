import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { SummaryEvent } from '../../shared/types'
import { api } from '@/lib/api'
import { useSpace } from '@/lib/space'
import { Button } from '@/components/ui/button'
import { DocEditor, useDoc } from '@/components/DocEditor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * 一枚の Markdown 文書。読み書きの口と、画面に出す文言だけを持つ。
 */
interface DocSpec {
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
 * 文書の確認と編集。保存を押すまでファイルは変わらない。
 *
 * 二枚以上あれば札で並べる。札を切り替えても下書きは残したいので、どの枚も
 * 出しっぱなしにして、選んでいないものを隠すだけにしてある。
 */
export function DocsDialog({
  open,
  onOpenChange,
  source,
  specs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 読み直しの目印。スペースや対象が変われば読み直させる。 */
  source: string
  specs: DocSpec[]
}) {
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  const at = index < specs.length ? index : 0

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{specs[at].label}</DialogTitle>
          <DialogDescription>{specs[at].description}</DialogDescription>
        </DialogHeader>

        {specs.length > 1 && (
          <div className="flex gap-1">
            {specs.map((item, i) => (
              <Button
                key={item.label}
                type="button"
                size="sm"
                variant={i === at ? 'secondary' : 'ghost'}
                onClick={() => setIndex(i)}
                disabled={busy}
              >
                {item.label}
              </Button>
            ))}
          </div>
        )}

        {specs.map((item, i) => (
          <DocPane
            key={item.label}
            spec={item}
            open={open}
            source={`${source}#${i}`}
            active={i === at}
            onBusy={setBusy}
            onSaved={() => onOpenChange(false)}
          />
        ))}
      </DialogContent>
    </Dialog>
  )
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

/** スペース直下の文書。プロフィールは持ち主が居るスペースだけ。 */
export function SpaceDocsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const space = useSpace()
  const owner = space.owner

  const claude: DocSpec = {
    label: owner ? 'CLAUDE.md' : '家族の CLAUDE.md',
    description: owner
      ? 'あなたについての設定。どの会話でも効くよ。'
      : '家族みんなの秘書役の土台。どの会話にも効くよ。',
    placeholder: 'まだ書いていないよ。',
    load: () => space.api.getClaude(),
    save: (text) => space.api.saveClaude(text),
  }

  const profile: DocSpec | null = owner
    ? {
        label: 'プロフィール',
        description: 'どの会話でも覚えておいてほしいこと。会話のたびに読み込まれるよ。',
        placeholder: 'まだ書いていないよ。',
        load: () => api.getProfile(owner),
        save: (text) => api.saveProfile(owner, text),
      }
    : null

  return (
    <DocsDialog
      open={open}
      onOpenChange={onOpenChange}
      source={`root:${space.docKey()}`}
      specs={profile ? [profile, claude] : [claude]}
    />
  )
}
