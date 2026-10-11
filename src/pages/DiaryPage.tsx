import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Loader2, MessageSquare, Pencil, RefreshCw, UserRound } from 'lucide-react'
import type { DiaryDay, DiaryEntry } from '../../shared/types'
import { diaryDayHref, useSpace } from '@/lib/space'
import { useDocumentTitle } from '@/lib/title'
import { cn } from '@/lib/utils'
import { SpaceHeaderSlot } from '@/components/SpaceHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const DAY = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
const MONTH = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' })

/** 日記の日付は端末の時刻ではなく、サーバーが決めた YYYY-MM-DD。昼に置いて日付ずれを避ける。 */
function noon(date: string): Date {
  return new Date(`${date}T12:00:00`)
}

function dayLabel(date: string): string {
  return DAY.format(noon(date))
}

/**
 * 「いまなにしとる」の日記。一覧と一日分を同じ画面で出し分ける。
 * 共有スペースには日記が無いので、経路だけ同じにして中身は出さない。
 */
export default function DiaryPage() {
  const space = useSpace()
  const { date } = useParams()
  useDocumentTitle(date ? `${dayLabel(date)}の日記` : '日記')

  if (!space.diary) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">共有スペースに日記は無いよ</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-3 py-3">
      {date ? <DiaryDayView date={date} /> : <DiaryList />}
    </main>
  )
}

function DiaryList() {
  const space = useSpace()
  const [days, setDays] = useState<DiaryDay[] | null>(null)
  const [today, setToday] = useState('')
  const [proposals, setProposals] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    space.confirm()
    space.api
      .listDiary()
      .then((doc) => {
        setDays(doc.days)
        setToday(doc.today)
      })
      .catch((cause: Error) => setError(cause.message))
    // 直し案が読めなくても日記は見られる。
    space.api.getProfileProposal().then((proposal) => setProposals(proposal?.changes.length ?? 0), () => {})
  }, [space])

  const months = useMemo(() => {
    const groups: { key: string; label: string; days: DiaryDay[] }[] = []
    for (const day of days ?? []) {
      const key = day.date.slice(0, 7)
      const last = groups.at(-1)
      if (last?.key === key) last.days.push(day)
      else groups.push({ key, label: MONTH.format(noon(day.date)), days: [day] })
    }
    return groups
  }, [days])

  return (
    <>
      <SpaceHeaderSlot>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">日記</h1>
          <p className="text-muted-foreground text-xs">「いまなにしとる？」への答えを、次の朝にまとめるよ</p>
        </div>
      </SpaceHeaderSlot>

      {proposals > 0 && (
        <Link
          to={space.profile}
          className="bg-primary/10 text-foreground hover:bg-primary/15 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm"
        >
          <UserRound className="text-primary size-4 shrink-0" />
          <span className="min-w-0 flex-1">プロフィールの直し案が {proposals} 件あるよ</span>
          <span className="text-muted-foreground text-xs">見る</span>
        </Link>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
      {!error && days === null && <p className="text-muted-foreground text-sm">読み込み中…</p>}
      {days?.length === 0 && (
        <p className="text-muted-foreground py-10 text-center text-sm leading-relaxed">
          まだ日記が無いよ。
          <br />
          「いまなにしとる？」が届いたら答えてみて。
        </p>
      )}

      {months.map((month) => (
        <section key={month.key} className="flex flex-col gap-2">
          <h2 className="text-muted-foreground px-1 text-xs font-medium">{month.label}</h2>
          <ul className="flex flex-col gap-2">
            {month.days.map((day) => (
              <li key={day.date}>
                <DayRow day={day} today={day.date === today} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function DayRow({ day, today }: { day: DiaryDay; today: boolean }) {
  const space = useSpace()
  const written = day.preview !== null
  const href = diaryDayHref(space.home, day.date)

  if (!written) {
    return (
      <Link
        to={href}
        className="text-muted-foreground hover:bg-muted/50 flex items-baseline justify-between gap-3 rounded-xl border border-dashed px-3.5 py-2.5 text-sm"
      >
        <span className="font-mono text-xs tabular-nums">{dayLabel(day.date)}</span>
        <span className="text-xs">{today ? '今日。次の朝に書くよ' : '答えなし'}</span>
      </Link>
    )
  }

  return (
    <Link to={href} className="bg-card hover:bg-muted/40 flex flex-col gap-1.5 rounded-xl border px-3.5 py-3">
      <div className="text-primary flex items-baseline justify-between gap-3 font-mono text-xs tabular-nums">
        <span>{dayLabel(day.date)}</span>
        <span className="text-muted-foreground">答え {day.answers}</span>
      </div>
      {day.firstAnswer && (
        <p className="text-muted-foreground border-primary/60 truncate border-l-2 pl-2 text-xs">
          「{day.firstAnswer}」
        </p>
      )}
      <p className="line-clamp-2 text-sm leading-relaxed">{day.preview}</p>
    </Link>
  )
}

function DiaryDayView({ date }: { date: string }) {
  const space = useSpace()
  const [entry, setEntry] = useState<DiaryEntry | null>(null)
  const [topic, setTopic] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotice(null)
    setEditing(false)
    setConfirming(false)
    space.api
      .getDiary(date)
      .then((doc) => {
        if (cancelled) return
        setEntry(doc.entry)
        setTopic(doc.topic)
      })
      .catch((cause: Error) => !cancelled && setNotice(cause.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [space, date])

  async function write() {
    // 人が直した記録も書き直すので、直した日は一度止める。
    if (entry?.edited && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setWriting(true)
    setNotice(null)
    try {
      setEntry(await space.api.writeDiary(date))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '書けませんでした')
    } finally {
      setWriting(false)
    }
  }

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      setEntry(await space.api.saveDiary(date, draft))
      setEditing(false)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const busy = writing || saving

  return (
    <>
      <SpaceHeaderSlot>
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to={space.diary!}
            aria-label="日記の一覧へ"
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <ChevronLeft className="size-4" />
          </Link>
          <h1 className="truncate text-base font-semibold">{dayLabel(date)}の日記</h1>
        </div>
      </SpaceHeaderSlot>

      {loading && <p className="text-muted-foreground text-sm">読み込み中…</p>}

      {!loading && (
        <>
          {entry && (
            <section className="flex flex-col gap-2">
              <h2 className="text-muted-foreground px-1 text-xs font-medium">答え</h2>
              <ul className="flex flex-col gap-2">
                {entry.answers.map((answer, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed">
                    <span className="text-primary shrink-0 pt-px font-mono text-xs tabular-nums">{answer.at}</span>
                    <span className="min-w-0 break-words whitespace-pre-wrap">{answer.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {entry && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-muted-foreground text-xs font-medium">
                  記録{entry.edited && <span className="ml-1.5 opacity-70">（直してある）</span>}
                </h2>
                {!editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setDraft(entry.record)
                      setEditing(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                    直す
                  </Button>
                )}
              </div>
              {editing ? (
                <>
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={8}
                    readOnly={saving}
                    className="text-sm leading-relaxed"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
                      やめる
                    </Button>
                    <Button size="sm" disabled={saving || draft === entry.record} onClick={save}>
                      {saving && <Loader2 className="size-4 animate-spin" />}
                      保存
                    </Button>
                  </div>
                </>
              ) : (
                <p className="bg-card rounded-xl border px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {entry.record}
                </p>
              )}
            </section>
          )}

          {!entry && (
            <p className="text-muted-foreground py-6 text-center text-sm leading-relaxed">
              この日の日記はまだ無いよ。
              <br />
              答えがあれば、次の朝 4 時を過ぎたころに書くよ。
            </p>
          )}

          {notice && <p className="text-destructive text-sm">{notice}</p>}
          {confirming && (
            <p className="text-sm">直した記録も会話から書き直すよ。よければもう一度押してね。</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {topic && (
              <Link to={space.href(topic)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <MessageSquare className="size-4" />
                元の会話
              </Link>
            )}
            {topic && !editing && (
              <Button
                variant={confirming ? 'default' : 'secondary'}
                size="sm"
                disabled={busy}
                onClick={write}
                className={cn(!entry && 'ml-auto')}
              >
                {writing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {writing ? '書いとる…' : entry ? '書き直す' : '今すぐ書く'}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  )
}
