import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, RefreshCw, RotateCcw, SendHorizontal } from 'lucide-react'
import type { AgentRun, LogEntry } from '../../shared/types'
import type { ConsultTurn } from '../../shared/tag-consult'
import { api } from '@/lib/api'
import { rememberedKey } from '@/lib/admin-key'
import { useDocumentTitle } from '@/lib/title'
import { cn } from '@/lib/utils'
import { ReplyBubble, UserBubble } from '@/components/Bubble'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Tab = 'speed' | 'logs' | 'ask'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'speed', label: '返事の速さ' },
  { id: 'logs', label: 'ログ' },
  { id: 'ask', label: 'AI に聞く' },
]

/**
 * 診断の画面。サーバーが自分で残したログと CLI の時間を見て、足りなければ AI に聞く。
 * 鍵は管理画面と同じで、URL の `?key=` か、一度開けた端末に残った分を使う。
 */
export default function DiagnosticPage() {
  useDocumentTitle('診断')
  const [params] = useSearchParams()
  const [key] = useState(() => rememberedKey(params.get('key')))
  const [tab, setTab] = useState<Tab>('speed')
  const [runs, setRuns] = useState<AgentRun[] | null>(null)
  const [logs, setLogs] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ask = useDiagnose(key)

  const load = useCallback(() => {
    Promise.all([api.agentRuns(key), api.serverLogs(key)])
      .then(([nextRuns, nextLogs]) => {
        setRuns(nextRuns.runs)
        setLogs(nextLogs.entries)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [key])

  useEffect(load, [load])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))]">
        <div>
          <h1 className="text-base font-semibold">kokuboke</h1>
          <p className="text-muted-foreground text-xs">
            診断
            <span className="mx-1.5 opacity-40">·</span>
            <Link to="/admin" className="underline underline-offset-4">
              管理
            </Link>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className="size-4" />
          読み直す
        </Button>
      </header>

      <nav className="flex gap-1 border-b px-3 py-2">
        {TABS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={tab === item.id ? 'secondary' : 'ghost'}
            onClick={() => {
              setTab(item.id)
              if (item.id !== 'ask') load()
            }}
          >
            {item.label}
            {item.id === 'ask' && ask.busy && <Loader2 className="size-3.5 animate-spin" />}
          </Button>
        ))}
      </nav>

      <main className="flex flex-1 flex-col gap-6 px-4 py-4 text-sm">
        {error && <p className="text-destructive leading-relaxed">{error}</p>}
        {tab === 'speed' && <SpeedSection runs={runs} />}
        {tab === 'logs' && <LogSection logs={logs} />}
        {tab === 'ask' && <AskSection ask={ask} />}
      </main>
    </div>
  )
}

function seconds(ms: number | null): string {
  if (ms === null) return '-'
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}秒`
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

const TIME = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function timeOf(iso: string): string {
  return TIME.format(new Date(iso))
}

function runLabel(run: AgentRun): string {
  return [run.engine, run.model, run.effort].filter(Boolean).join(' / ')
}

function numbers(list: Array<number | null>): number[] {
  return list.filter((value): value is number => value !== null)
}

/** 組み合わせごとの中央値と、最近の一回ずつ。 */
function SpeedSection({ runs }: { runs: AgentRun[] | null }) {
  const groups = useMemo(() => {
    const map = new Map<string, AgentRun[]>()
    for (const run of runs ?? []) {
      const label = runLabel(run)
      map.set(label, [...(map.get(label) ?? []), run])
    }
    return [...map.entries()]
      .map(([label, list]) => {
        const first = numbers(list.map((run) => run.firstMs))
        return {
          label,
          count: list.length,
          last: list.at(-1)!.at,
          init: median(numbers(list.map((run) => run.initMs))),
          first: median(first),
          worst: first.length > 0 ? Math.max(...first) : null,
          total: median(list.map((run) => run.totalMs)),
        }
      })
      .sort((a, b) => b.last.localeCompare(a.last))
  }, [runs])

  if (runs === null) return <p className="text-muted-foreground">読み込み中…</p>
  if (runs.length === 0) return <p className="text-muted-foreground">まだ CLI を走らせた記録が無いよ</p>

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide">
          組み合わせごと（中央値）
        </h2>
        <ul className="flex flex-col">
          {groups.map((group) => (
            <li key={group.label} className="flex flex-col gap-1 border-b py-2.5 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{group.label}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{group.count} 回</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                支度 {seconds(group.init)}
                <span className="mx-1.5 opacity-40">·</span>
                一文字目 <span className="text-foreground">{seconds(group.first)}</span>（最悪{' '}
                {seconds(group.worst)}）
                <span className="mx-1.5 opacity-40">·</span>
                終わり {seconds(group.total)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide">最近の 30 回</h2>
        <ul className="flex flex-col">
          {runs
            .slice(-30)
            .reverse()
            .map((run, i) => (
              <li key={`${run.at}-${i}`} className="flex flex-col gap-0.5 border-b py-2 last:border-b-0">
                <div className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate">{runLabel(run)}</span>
                  <span className="shrink-0">{timeOf(run.at)}</span>
                </div>
                <p className="font-mono text-xs">
                  支度 {seconds(run.initMs)} · 一文字目 {seconds(run.firstMs)} · 終わり{' '}
                  {seconds(run.totalMs)} · 道具 {run.tools}
                  {run.exit !== 'code=0' && <span className="text-destructive"> · {run.exit}</span>}
                </p>
              </li>
            ))}
        </ul>
      </section>
    </>
  )
}

const SHOWN_LOGS = 300

/** 新しい順。アクセスの行（`-->`）は多いので、出すかどうかを選ばせる。 */
function LogSection({ logs }: { logs: LogEntry[] | null }) {
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [withAccess, setWithAccess] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (logs ?? [])
      .filter((entry) => !problemsOnly || entry.level !== 'log')
      .filter((entry) => withAccess || !entry.text.startsWith('--> '))
      .filter((entry) => !needle || entry.text.toLowerCase().includes(needle))
      .slice(-SHOWN_LOGS)
      .reverse()
  }, [logs, problemsOnly, withAccess, query])

  if (logs === null) return <p className="text-muted-foreground">読み込み中…</p>

  return (
    <section className="flex flex-col gap-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="絞り込む（例: [agent]）"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={problemsOnly}
            onChange={() => setProblemsOnly((value) => !value)}
            className="accent-primary size-4"
          />
          警告と失敗だけ
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={withAccess}
            onChange={() => setWithAccess((value) => !value)}
            className="accent-primary size-4"
          />
          アクセスの行も出す
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground">当てはまる行が無いよ</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((entry, i) => (
            <li key={`${entry.at}-${i}`} className="flex flex-col gap-0.5 border-b py-1.5 last:border-b-0">
              <span className="text-muted-foreground text-[11px]">{timeOf(entry.at)}</span>
              <span
                className={cn(
                  'font-mono text-xs leading-relaxed break-all whitespace-pre-wrap',
                  entry.level === 'error' && 'text-destructive',
                  entry.level === 'warn' && 'text-amber-600 dark:text-amber-400',
                )}
              >
                {entry.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * 診断の AI とのやり取り。どこにも保存せず、この画面が開いている間だけ持つ。
 * タブを行き来しても流している返事は止めない。
 */
function useDiagnose(key: string) {
  const [turns, setTurns] = useState<ConsultTurn[]>([])
  const [streaming, setStreaming] = useState<string | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  /** 送れたら true。失敗したら発言は取り下げる（画面が書きかけを戻す）。 */
  const send = useCallback(
    async (text: string) => {
      if (abort.current) return false
      const base = turns
      const next: ConsultTurn[] = [...base, { role: 'user', text }]
      setTurns(next)
      setStreaming('')
      setActivity(null)
      setError(null)

      const controller = new AbortController()
      abort.current = controller
      let raw = ''
      try {
        for await (const event of api.diagnose(key, next, controller.signal)) {
          if (event.type === 'delta') {
            raw += event.text
            setStreaming(raw)
          }
          if (event.type === 'activity') setActivity(event.label)
          if (event.type === 'done') raw = event.text
          if (event.type === 'error') throw new Error(event.message)
        }
        if (!raw.trim()) throw new Error('返事が空だったよ')
        setTurns([...next, { role: 'assistant', text: raw }])
        return true
      } catch (cause) {
        if (controller.signal.aborted) return false
        setTurns(base)
        setError(cause instanceof Error ? cause.message : '診断の返事を書けませんでした')
        return false
      } finally {
        if (abort.current === controller) {
          abort.current = null
          setStreaming(null)
          setActivity(null)
        }
      }
    },
    [key, turns],
  )

  const reset = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setTurns([])
    setStreaming(null)
    setActivity(null)
    setError(null)
  }, [])

  return { turns, streaming, activity, error, busy: streaming !== null, send, reset }
}

type DiagnoseState = ReturnType<typeof useDiagnose>

const SUGGESTIONS = [
  '最近の返事で遅かったものを挙げて、どこで時間がかかっとるか調べて',
  '最近の警告と失敗を見て、原因と直し方を教えて',
]

function AskSection({ ask }: { ask: DiagnoseState }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const { turns, streaming, activity, error, busy } = ask

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [turns.length, streaming])

  async function submit(body = text.trim()) {
    if (!body || busy) return
    setText('')
    if (!(await ask.send(body))) setText(body)
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground px-1 text-xs leading-relaxed">
          最近のログと CLI の時間を渡して聞くよ。AI はソースとログのファイルも読める（書き換えはしない）。
          やり取りはどこにも残らん。
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={turns.length === 0 && !busy}
          onClick={ask.reset}
        >
          <RotateCcw className="size-3.5" />
          最初から
        </Button>
      </div>

      {turns.length === 0 && !busy && (
        <div className="flex flex-col items-start gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto py-2 text-left whitespace-normal"
              onClick={() => void submit(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <UserBubble key={index} text={turn.text} />
          ) : (
            <div key={index} className="flex flex-col items-start">
              <ReplyBubble>
                <Markdown text={turn.text} />
              </ReplyBubble>
            </div>
          ),
        )}

        {streaming !== null && (
          <div className="flex flex-col items-start">
            <ReplyBubble>
              {streaming ? (
                <Markdown text={streaming} />
              ) : (
                <span className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-3.5 animate-spin" />
                  {activity ?? 'ログを読んでいるよ'}
                </span>
              )}
            </ReplyBubble>
          </div>
        )}

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
          aria-label="聞くこと"
          placeholder="気になっとることを書く"
          className="max-h-40 min-h-10 resize-none py-2.5 text-[15px]"
        />
        <Button type="submit" size="icon" aria-label="送る" disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </Button>
      </form>
    </div>
  )
}
