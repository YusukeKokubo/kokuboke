import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2, RotateCcw, SendHorizontal } from 'lucide-react'
import type { SummaryEvent } from '../../shared/types'
import { applyDiff, lineDiff, splitConsult, type ConsultTurn } from '../../shared/tag-consult'
import { ReplyBubble, UserBubble } from '@/components/Bubble'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Run = (
  input: { turns: ConsultTurn[]; current: string },
  signal: AbortSignal,
) => AsyncGenerator<SummaryEvent>

interface Entry extends ConsultTurn {
  /** 案のうち本文に入れた件数。入れる前は undefined。 */
  applied?: number
}

/**
 * タグ本文の相談。やり取りはどこにも保存せず、タグのページが開いている間だけ持つ。
 * 相談の画面と本文の画面を行き来しても、流している返事は止めない。
 */
export function useTagConsult(run: Run) {
  const [entries, setEntries] = useState<Entry[]>([])
  /** 流している返事。null なら待っていない。 */
  const [streaming, setStreaming] = useState<string | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const started = useRef(false)

  useEffect(() => () => abort.current?.abort(), [])

  /** 送れたら true。失敗したら発言は取り下げる（画面が書きかけを戻す）。 */
  const ask = useCallback(
    async (text: string | null, current: string, base: Entry[]) => {
      if (abort.current) return false
      const next: Entry[] = text ? [...base, { role: 'user', text }] : base
      setEntries(next)
      setStreaming('')
      setActivity(null)
      setError(null)

      const controller = new AbortController()
      abort.current = controller
      let raw = ''
      try {
        const turns = next.map(({ role, text: body }) => ({
          role,
          text: body,
        }))
        for await (const event of run({ turns, current }, controller.signal)) {
          if (event.type === 'delta') {
            raw += event.text
            setStreaming(raw)
          }
          if (event.type === 'activity') setActivity(event.label)
          if (event.type === 'done') raw = event.text
          if (event.type === 'error') throw new Error(event.message)
        }
        if (!raw.trim()) throw new Error('返事が空だったよ')
        setEntries([...next, { role: 'assistant', text: raw }])
        return true
      } catch (cause) {
        if (controller.signal.aborted) return false
        setEntries(base)
        setError(cause instanceof Error ? cause.message : '相談の返事を書けませんでした')
        return false
      } finally {
        // 「最初から」で止めた回は、もう次の回が走っている。そちらの状態には触らない。
        if (abort.current === controller) {
          abort.current = null
          setStreaming(null)
          setActivity(null)
        }
      }
    },
    [run],
  )

  /** 初めて開いたとき、AI の方から会話を読んで聞いてくる。 */
  const start = useCallback(
    (current: string) => {
      if (started.current) return
      started.current = true
      void ask(null, current, [])
    },
    [ask],
  )

  const reset = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    started.current = false
    setEntries([])
    setStreaming(null)
    setActivity(null)
    setError(null)
  }, [])

  const markApplied = useCallback((index: number, count: number) => {
    setEntries((list) => list.map((entry, i) => (i === index ? { ...entry, applied: count } : entry)))
  }, [])

  return {
    entries,
    streaming,
    activity,
    error,
    busy: streaming !== null,
    send: (text: string, current: string) => ask(text, current, entries),
    start,
    reset,
    markApplied,
  }
}

export type TagConsultState = ReturnType<typeof useTagConsult>

export function TagConsult({
  consult,
  current,
  chatCount,
  onApply,
  onClose,
}: {
  consult: TagConsultState
  /** 書きかけの本文。案との差はこれに対して取る。 */
  current: string
  chatCount: number | null
  onApply: (text: string, count: number) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const { entries, streaming, activity, error, busy, start } = consult

  useEffect(() => {
    start(current)
    // 開いた時点の本文で始める。あとで書き換わっても始め直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries.length, streaming])

  // 案のカードを出すのは最後の案だけ。前の案は畳んでおく。
  const latest = entries.findLastIndex(
    (entry) => entry.role === 'assistant' && splitConsult(entry.text).proposal !== null,
  )

  async function submit() {
    const body = text.trim()
    if (!body || busy) return
    setText('')
    if (!(await consult.send(body, current))) setText(body)
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="size-4" />
          本文へ戻る
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={entries.length === 0 && !busy}
          onClick={() => {
            consult.reset()
            start(current)
          }}
        >
          <RotateCcw className="size-3.5" />
          最初から
        </Button>
      </div>

      <p className="text-muted-foreground px-1 text-xs">
        {chatCount === null ? '今の本文と' : `今の本文と、このタグの会話 ${chatCount} 件を`}
        読んで相談するよ。ここで決めた直しは、選んで本文に入れられる。
      </p>

      <div className="flex flex-col gap-3">
        {entries.map((entry, index) =>
          entry.role === 'user' ? (
            <UserBubble key={index} text={entry.text} />
          ) : (
            <AssistantEntry
              key={index}
              raw={entry.text}
              applied={entry.applied}
              live={index === latest}
              current={current}
              onApply={(next, count) => {
                consult.markApplied(index, count)
                onApply(next, count)
              }}
            />
          ),
        )}

        {streaming !== null && <StreamingEntry raw={streaming} activity={activity} />}

        {error && <p className="text-destructive px-1 text-sm">{error}</p>}
        <div ref={end} />
      </div>

      <form
        className="bg-background sticky bottom-0 mt-auto flex items-end gap-2 border-t pt-2 pb-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // スマホでの改行を潰したくないので、送信は Ctrl / ⌘ + Enter だけ。
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          rows={1}
          aria-label="相談の内容"
          placeholder="足したい決まりや、要らない項目を話す"
          className="max-h-40 min-h-10 resize-none py-2.5 text-[15px]"
        />
        <Button type="submit" size="icon" aria-label="送る" disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </Button>
      </form>
    </div>
  )
}

function StreamingEntry({ raw, activity }: { raw: string; activity: string | null }) {
  const { reply, writing } = splitConsult(raw)
  return (
    <div className="flex flex-col items-start gap-2">
      <ReplyBubble>
        {reply ? (
          <Markdown text={reply} />
        ) : (
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            {activity ?? '会話を読んでいるよ'}
          </span>
        )}
      </ReplyBubble>
      {writing && (
        <p className="text-muted-foreground flex items-center gap-2 px-1 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          本文の直しを書いているよ
        </p>
      )}
    </div>
  )
}

function AssistantEntry({
  raw,
  applied,
  live,
  current,
  onApply,
}: {
  raw: string
  applied?: number
  live: boolean
  current: string
  onApply: (text: string, count: number) => void
}) {
  const { reply, proposal } = splitConsult(raw)
  return (
    <div className="flex flex-col items-start gap-2">
      {reply && (
        <ReplyBubble>
          <Markdown text={reply} />
        </ReplyBubble>
      )}
      {proposal !== null &&
        (applied !== undefined ? (
          <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
            <Check className="size-3.5" />
            この案から {applied} 件を本文に入れたよ
          </p>
        ) : live ? (
          <ProposalCard proposal={proposal} current={current} onApply={onApply} />
        ) : (
          <p className="text-muted-foreground px-1 text-xs">この案は、あとの案に置き換わったよ</p>
        ))}
    </div>
  )
}

function ProposalCard({
  proposal,
  current,
  onApply,
}: {
  proposal: string
  current: string
  onApply: (text: string, count: number) => void
}) {
  const segments = useMemo(() => lineDiff(current, proposal), [current, proposal])
  const changes = segments.filter((segment) => segment.kind === 'change')
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set())
  const picked = new Set(changes.map((change) => change.id).filter((id) => !skipped.has(id)))

  if (changes.length === 0) {
    return <p className="text-muted-foreground px-1 text-xs">今の本文と同じだから、入れるものはないよ</p>
  }

  return (
    <div className="bg-card w-full max-w-[92%] overflow-hidden rounded-2xl border">
      <div className="text-muted-foreground flex items-center justify-between px-3.5 pt-3 pb-1 text-xs">
        <span className="text-foreground text-[13px] font-semibold">本文の直し</span>
        <span>入れない直しはチェックを外してね</span>
      </div>
      <ul className="flex flex-col">
        {changes.map((change) => (
          <li key={change.id}>
            <label className="flex cursor-pointer items-start gap-2.5 px-3.5 py-2">
              <input
                type="checkbox"
                checked={picked.has(change.id)}
                onChange={() =>
                  setSkipped((prev) => {
                    const next = new Set(prev)
                    if (next.has(change.id)) next.delete(change.id)
                    else next.add(change.id)
                    return next
                  })
                }
                className="accent-primary mt-1 size-4 shrink-0"
              />
              <span className="flex min-w-0 flex-col gap-0.5 font-mono text-[13px] leading-relaxed break-words">
                {change.removed.map((line, i) => (
                  <span key={`r${i}`} className="text-destructive line-through decoration-1">
                    {line || '（空行）'}
                  </span>
                ))}
                {change.added.map((line, i) => (
                  <span key={`a${i}`} className={cn('font-medium', line ? '' : 'text-muted-foreground')}>
                    {line || '（空行）'}
                  </span>
                ))}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="px-3.5 pt-1 pb-3.5">
        <Button
          type="button"
          className="w-full"
          disabled={picked.size === 0}
          onClick={() => onApply(applyDiff(segments, picked), picked.size)}
        >
          {picked.size > 0 ? `選んだ ${picked.size} 件を本文に入れる` : '選んだ直しがないよ'}
        </Button>
      </div>
    </div>
  )
}
