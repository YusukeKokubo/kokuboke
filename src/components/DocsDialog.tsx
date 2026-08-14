import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { SummaryEvent, TopicRef } from '../../shared/types'
import { api } from '@/lib/api'
import { useSpace } from '@/lib/space'
import { Button } from '@/components/ui/button'
import { DocEditor, useDoc, useStableRef } from '@/components/DocEditor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * 一枚の Markdown 文書。読み書きの口と、画面に出す文言だけを持つ。
 * トピックなら要約と CLAUDE.md、スペース直下ならプロフィールと CLAUDE.md。
 */
interface DocSpec {
  /** 札と見出しに使う。 */
  label: string
  description: string
  placeholder: string
  load: () => Promise<string>
  save: (text: string) => Promise<string>
  /** AI に下書きさせられる文書だけ。いまは要約だけ。モデルはトピックのものを使う。 */
  draft?: (signal: AbortSignal) => AsyncGenerator<SummaryEvent>
}

/**
 * 文書の確認と編集。保存を押すまでファイルは変わらない。
 *
 * 二枚以上あれば札で並べる。札を切り替えても下書きは残したいので、どの枚も
 * 出しっぱなしにして、選んでいないものを隠すだけにしてある。
 */
function DocsDialog({
  open,
  onOpenChange,
  source,
  specs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 読み直しの目印。スペースやトピックが変われば読み直させる。 */
  source: string
  specs: DocSpec[]
}) {
  const [index, setIndex] = useState(0)
  // 塞がるのは触れる札だけなので、いま出ている一枚から受け取れば足りる。
  const [busy, setBusy] = useState(false)

  // 札が減る（トピックからスペース直下へ、など）と、選んでいた札が消えることがある。
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
function DocPane({
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

function empty(): Promise<string> {
  return Promise.resolve('')
}

type TopicDocProps = {
  target: TopicRef | null
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: 'summary' | 'claude'
}

/** トピックの文書。要約は AI に下書きさせられる。CLAUDE.md は手で書く。 */
export function TopicDocsDialog({ target, open, onOpenChange, tab }: TopicDocProps) {
  const space = useSpace()
  const ref = useStableRef(target)
  const sub = ref?.kind === 'child' ? ref.sub : undefined

  const spec: DocSpec =
    tab === 'summary'
      ? {
          label: '要約',
          description: sub
            ? '会話のたびに読み込まれる覚え書き。そのまま直してもいいし、AI に整理させてもいいよ。'
            : '中のどれで話しても効く共有の覚え書き。そのまま直してもいいし、AI に整理させてもいいよ。',
          placeholder: 'まだ何も覚えていないよ。',
          load: () => (ref ? space.api.getSummary(ref) : empty()),
          save: async (text) => (ref ? space.api.saveSummary(ref, text) : text),
          draft: ref ? (signal) => space.api.draftSummary(ref, signal) : undefined,
        }
      : {
          label: 'CLAUDE.md',
          description: sub
            ? 'この話での役割。上の話題の設定も一緒に読まれるよ。'
            : 'この話題での役割。上の CLAUDE.md も一緒に読まれるよ。',
          placeholder: 'まだ書いていないよ。',
          load: () => (ref ? space.api.getTopicClaude(ref) : empty()),
          save: async (text) => (ref ? space.api.saveTopicClaude(ref, text) : text),
        }

  return (
    <DocsDialog
      open={open && ref !== null}
      onOpenChange={onOpenChange}
      source={`${space.docKey(ref)}:${spec.label}`}
      specs={[spec]}
    />
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
      ? 'あなたについての設定。どの話題でも効くよ。'
      : '家族みんなの秘書役の土台。どのトピックの会話にも効くよ。',
    placeholder: 'まだ書いていないよ。',
    load: () => space.api.getClaude(),
    save: (text) => space.api.saveClaude(text),
  }

  const profile: DocSpec | null = owner
    ? {
        label: 'プロフィール',
        description: 'どの話題でも覚えておいてほしいこと。会話のたびに読み込まれるよ。',
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
