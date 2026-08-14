import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { SummaryEvent, TopicRef } from '../../shared/types'
import { api } from '@/lib/api'
import { useSpace } from '@/lib/space'
import { Button } from '@/components/ui/button'
import { ModelPicker, type ModelSelection } from '@/components/ModelPicker'
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
  /** AI に下書きさせられる文書だけ。いまは要約だけ。 */
  draft?: (choice: ModelSelection | null, signal: AbortSignal) => AsyncGenerator<SummaryEvent>
}

/**
 * 文書の確認と編集。保存を押すまでファイルは変わらない。
 *
 * 二枚まで札で並べる。切り替えても下書きは残すため、useDoc は開いている枚数に
 * かかわらず二つ呼ぶ（フックは数を変えられない）。二枚目が無いときは休ませる。
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
  specs: [DocSpec] | [DocSpec, DocSpec]
}) {
  const [index, setIndex] = useState(0)
  const [drafting, setDrafting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [choice, setChoice] = useState<ModelSelection | null>(null)
  const abort = useRef<AbortController | null>(null)

  const second = specs[1] ?? null
  const first = useDoc(open, `${source}#0`, specs[0].load)
  const rest = useDoc(open && second !== null, `${source}#1`, second?.load ?? empty)

  // 札が減る（トピックからスペース直下へ、など）と、選んでいた札が消えることがある。
  const current = index === 1 && second ? rest : first
  const spec = index === 1 && second ? second : specs[0]

  useEffect(() => {
    if (!open) abort.current?.abort()
  }, [open])

  const busy = drafting || first.busy || rest.busy

  async function handleDraft() {
    if (busy || !spec.draft || current.status === 'loading') return
    setDrafting(true)
    current.setNotice(null)

    const controller = new AbortController()
    abort.current = controller

    try {
      let text = ''
      for await (const event of spec.draft(choice, controller.signal)) {
        if (event.type === 'delta') {
          text += event.text
          current.setDraft(text)
        }
        // 要約は会話より時間がかかる。何をしているかは知らせ書きの場所を借りて出す。
        // 下書きの本文が流れ始めれば、そちらが進んでいるのが見えるので上書きしない。
        if (event.type === 'activity' && !text) current.setNotice(event.label)
        if (event.type === 'done') {
          current.setDraft(event.text)
          current.setNotice(`${event.modelLabel} が下書きしたよ。よければ保存してね。`)
        }
        if (event.type === 'error') current.setNotice(event.message)
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        current.setNotice(cause instanceof Error ? cause.message : '要約を整理できませんでした')
      }
    } finally {
      abort.current = null
      setDrafting(false)
    }
  }

  async function handleSave() {
    if (await current.save(spec.save)) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{spec.label}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>

        {second && (
          <div className="flex gap-1">
            {specs.map((item, at) => (
              <Button
                key={item.label}
                type="button"
                size="sm"
                variant={at === index ? 'secondary' : 'ghost'}
                onClick={() => setIndex(at)}
                disabled={busy}
              >
                {item.label}
              </Button>
            ))}
          </div>
        )}

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
          doc={current}
          placeholder={spec.placeholder}
          busy={drafting}
          onSave={handleSave}
          actions={
            spec.draft && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleDraft}
                  disabled={busy || current.status === 'loading'}
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
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}

function empty(): Promise<string> {
  return Promise.resolve('')
}

/** トピックの要約と CLAUDE.md。器でも子でも、どのスペースでも同じ口。 */
export function TopicDocsDialog({
  target,
  open,
  onOpenChange,
}: {
  /** どのトピックの文書か。閉じている間は null になりうる。 */
  target: TopicRef | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const space = useSpace()
  const ref = useStableRef(target)
  const sub = ref?.kind === 'child' ? ref.sub : undefined

  const summary: DocSpec = {
    label: '要約',
    description: sub
      ? '会話のたびに読み込まれる覚え書き。そのまま直してもいいし、AI に整理させてもいいよ。'
      : '中のどれで話しても効く共有の覚え書き。そのまま直してもいいし、AI に整理させてもいいよ。',
    placeholder: 'まだ何も覚えていないよ。',
    load: () => (ref ? space.api.getSummary(ref) : empty()),
    save: async (text) => (ref ? space.api.saveSummary(ref, text) : text),
    draft: ref ? (choice, signal) => space.api.draftSummary(ref, choice, signal) : undefined,
  }

  const claude: DocSpec = {
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
      source={space.docKey(ref)}
      specs={[summary, claude]}
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
