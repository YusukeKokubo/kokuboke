import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  LogIn,
  MessageCircleQuestion,
  RefreshCw,
  Smartphone,
  UserRound,
} from 'lucide-react'
import type {
  ActivityEntry,
  DiaryAdminEntry,
  DiarySettings,
  EngineId,
  EngineLogin,
  UpdateStatus,
} from '../../shared/types'
import { api } from '@/lib/api'
import { rememberedKey } from '@/lib/admin-key'
import { relativeLabel, topicLabel } from '@/lib/format'
import { personalHome, topicHref } from '@/lib/space'
import { useDocumentTitle } from '@/lib/title'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Phase = 'idle' | 'requested' | 'waiting' | 'done' | 'failed'

export default function AdminPage() {
  useDocumentTitle('管理')
  const [params] = useSearchParams()
  const [key] = useState(() => rememberedKey(params.get('key')))
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')

  const load = useCallback(() => {
    api
      .updateStatus(key)
      .then((next) => {
        setStatus(next)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))

    api
      .activity(key)
      .then((next) => {
        setEntries(next.entries)
        setActivityError(null)
      })
      .catch((cause: Error) => setActivityError(cause.message))
  }, [key])

  useEffect(load, [load])

  /**
   * 更新を頼んでから、コンテナが別のコミットで戻ってくるまで待つ。
   * 差し替えの最中は接続そのものが切れるので、fetch の失敗は途中の合図として扱う。
   */
  async function update() {
    const before = status?.commit ?? null
    setPhase('requested')
    setError(null)

    let result
    try {
      result = await api.requestUpdate(key)
    } catch (cause) {
      setPhase('failed')
      setError(cause instanceof Error ? cause.message : '更新を頼めませんでした')
      return
    }

    // 返事が返ってきて、しかも何も差し替わっていないなら、待つ意味がない。
    // GHCR にまだイメージが無いか、引けていないときにここへ来る。
    if (result && !result.replacing && !result.summary?.updated) {
      setPhase('failed')
      setError('差し替えるものが無かった。イメージがまだ上がっとらんか、GHCR から引けとらん')
      return
    }

    setPhase('waiting')

    // 引っ張って作り直すのに 1GB 前後の通信が入る。三分見て諦める。
    // 回数ではなく時計で区切るのは、一回の問い合わせが期限切れまで
    // 引っ張られることがあり、回数だと待つ長さが読めなくなるため。
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      try {
        const health = await api.health()
        if (health.commit && health.commit !== before) {
          setPhase('done')
          load()
          return
        }
      } catch {
        // 落ちている間と、接続が宙ぶらりんになったときはここに来る。まだ待つ。
      }
    }

    setPhase('failed')
    setError('入れ替わったか確かめられませんでした。ログを見てください')
  }

  const behind = status?.behind ?? 0
  const busy = phase === 'requested' || phase === 'waiting'

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))]">
        <div>
          <h1 className="text-base font-semibold">kokuboke</h1>
          <p className="text-muted-foreground text-xs">
            管理
            <span className="mx-1.5 opacity-40">·</span>
            <Link to="/diagnostic" className="underline underline-offset-4">
              診断
            </Link>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
          <RefreshCw className="size-4" />
          確認
        </Button>
      </header>

      <main className="flex flex-1 flex-col gap-8 px-4 py-4 text-sm">
        {error && <p className="text-destructive leading-relaxed">{error}</p>}

        <section className="flex flex-col gap-4">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide">更新</h2>

          {!error && status === null && <p className="text-muted-foreground">読み込み中…</p>}

          {status && (
            <>
              <dl className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">動いている版</dt>
                  <dd className="font-mono text-xs">{status.commit?.slice(0, 7) ?? '不明'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">GitHub の main</dt>
                  <dd className="font-mono text-xs">{status.latest?.slice(0, 7) ?? '不明'}</dd>
                </div>
              </dl>

              {status.error && <p className="text-muted-foreground leading-relaxed">{status.error}</p>}

              {!status.error && behind === 0 && (
                <p className="text-muted-foreground flex items-center gap-1.5">
                  <Check className="size-4" />
                  最新だよ
                </p>
              )}

              {behind > 0 && (
                <div className="flex flex-col gap-2">
                  <p>
                    {behind} コミット分の更新があるよ。
                    {status.docsOnly && '（文書だけなんで、入れ替えるものは無い）'}
                  </p>
                  <ul className="text-muted-foreground flex flex-col gap-1 text-xs leading-relaxed">
                    {status.commits.slice(0, 10).map((message, i) => (
                      <li key={i} className="truncate">
                        {message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {status.composeChanged && (
                <p className="text-destructive flex items-start gap-1.5 leading-relaxed">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    この更新には docker-compose.yml の変更が入っとる。イメージの差し替えだけでは
                    設定が古いまま残るので、NAS で <code>scripts/deploy.sh</code> を叩いて。
                  </span>
                </p>
              )}

              {behind > 0 && !status.docsOnly && status.canUpdate && (
                <Button onClick={update} disabled={busy} className="self-start">
                  <Download className="size-4" />
                  {phase === 'requested' && '頼んどる…'}
                  {phase === 'waiting' && '入れ替え中…'}
                  {!busy && '更新する'}
                </Button>
              )}

              {behind > 0 && !status.docsOnly && !status.canUpdate && (
                <p className="text-muted-foreground leading-relaxed">
                  この機械では更新を頼めない（Watchtower が居らんか、鍵が渡っとらん）。
                </p>
              )}

              {phase === 'waiting' && (
                <p className="text-muted-foreground leading-relaxed">
                  入れ替えの間は少しつながらんようになる。このまま待っとって。
                </p>
              )}

              {phase === 'done' && (
                <p className="flex items-center gap-1.5">
                  <Check className="size-4" />
                  新しい版で動き出したよ
                </p>
              )}
            </>
          )}
        </section>

        <DiarySection adminKey={key} />

        <LoginSection adminKey={key} engine="claude" title="Claude Code のログイン" />
        <LoginSection adminKey={key} engine="cursor" title="Cursor のログイン" />

        <section className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide">最新の会話</h2>

          {activityError && <p className="text-destructive leading-relaxed">{activityError}</p>}

          {!activityError && entries === null && (
            <p className="text-muted-foreground">読み込み中…</p>
          )}

          {!activityError && entries && entries.length === 0 && (
            <p className="text-muted-foreground">まだ会話が無いよ</p>
          )}

          {!activityError && entries && entries.length > 0 && (
            <ul className="flex flex-col">
              {entries.map((entry) => (
                <li key={entry.user} className="border-b last:border-b-0">
                  <Link
                    to={topicHref(personalHome(entry.user), entry.slug)}
                    className="hover:bg-muted/50 -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-2.5"
                  >
                    <div className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate">
                        {entry.user}
                        <span className="mx-1.5 opacity-40">·</span>
                        {topicLabel(entry)}
                      </span>
                      <span className="shrink-0">{relativeLabel(entry.at)}</span>
                    </div>
                    <p className="flex items-center gap-1.5 truncate leading-relaxed">
                      {entry.text ||
                        (entry.imageCount > 0
                          ? '（画像）'
                          : entry.fileCount > 0
                            ? '（ファイル）'
                            : '（空）')}
                      {entry.imageCount > 0 && (
                        <ImageIcon className="text-muted-foreground size-3.5 shrink-0" />
                      )}
                      {entry.fileCount > 0 && (
                        <FileText className="text-muted-foreground size-3.5 shrink-0" />
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

/**
 * CLI のログイン。ログインを押すとサーバーが CLI を起こして URL を返すので、
 * それを開いて認証してもらう。Claude Code は認証のあとに出るコードを貼って返す。
 * 済むまで数秒おきに様子を聞きに行く。
 */
function LoginSection({ adminKey, engine, title }: { adminKey: string; engine: EngineId; title: string }) {
  const [state, setState] = useState<EngineLogin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(() => {
    api
      .engineLogin(adminKey, engine)
      .then((next) => {
        setState(next)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [adminKey, engine])

  useEffect(load, [load])

  const waiting = state?.flow.phase === 'waiting'

  // 認証はこの画面の外（別のタブ）で済むので、戻ってきたのを待って聞き直す。
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [waiting, load])

  async function start() {
    setStarting(true)
    setError(null)
    setCode('')
    try {
      setState(await api.startLogin(adminKey, engine))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ログインを始められませんでした')
    } finally {
      setStarting(false)
    }
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault()
    if (!code.trim()) return
    setSending(true)
    setError(null)
    try {
      setState(await api.submitLoginCode(adminKey, engine, code))
      setCode('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'コードを渡せませんでした')
    } finally {
      setSending(false)
    }
  }

  const flow = state?.flow

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide">{title}</h2>

      {error && <p className="text-destructive leading-relaxed">{error}</p>}
      {!error && state === null && <p className="text-muted-foreground">読み込み中…</p>}

      {state && !state.installed && (
        <p className="text-muted-foreground leading-relaxed">この機械には CLI が入っとらん。</p>
      )}

      {state?.installed && (
        <>
          {state.account ? (
            <p className="flex items-center gap-1.5">
              <Check className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{state.account} でログインしとるよ</span>
            </p>
          ) : (
            <p className="text-muted-foreground">ログインしとらん</p>
          )}

          {flow?.phase === 'waiting' && (
            <div className="flex flex-col gap-2">
              <p className="leading-relaxed">
                {flow.needsCode
                  ? '下のリンクを開いて認証して。最後にコードが出るで、それを下に貼って送って。'
                  : '下のリンクを開いて、Cursor のアカウントで認証して。済んだらここが勝手に変わるでね。'}
              </p>
              <a
                href={flow.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary flex items-center gap-1.5 self-start underline underline-offset-4"
              >
                <ExternalLink className="size-4" />
                認証のページを開く
              </a>
              {flow.needsCode ? (
                <form onSubmit={sendCode} className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="コードを貼る"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <Button type="submit" disabled={sending || !code.trim()}>
                    {sending ? '送っとる…' : '送る'}
                  </Button>
                </form>
              ) : (
                <p className="text-muted-foreground animate-pulse text-xs">待っとる…</p>
              )}
              {flow.notice && (
                <p className="text-destructive leading-relaxed whitespace-pre-wrap">{flow.notice}</p>
              )}
            </div>
          )}

          {flow?.phase === 'failed' && (
            <p className="text-destructive leading-relaxed whitespace-pre-wrap">{flow.message}</p>
          )}

          {!waiting && (
            <Button
              onClick={start}
              disabled={starting}
              variant={state.account ? 'outline' : 'default'}
              className="self-start"
            >
              <LogIn className="size-4" />
              {starting ? '支度しとる…' : state.account ? 'ログインし直す' : 'ログインする'}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

const HOURS_FROM = Array.from({ length: 20 }, (_, i) => i + 4)
const HOURS_TO = Array.from({ length: 20 }, (_, i) => i + 5)
const COUNTS = [1, 2, 3, 4, 5, 6]

const SLOT_LABEL: Record<DiaryAdminEntry['today'][number]['state'], string> = {
  pending: 'これから',
  asked: '聞いた',
  skipped: '飛ばした',
}

/**
 * 「いまなにしとる」を誰にいつ聞くか。人ごとに時間帯と回数を決める。
 * 端末の無い人はオンにしても聞かないので、その旨を横に出す。
 */
function DiarySection({ adminKey }: { adminKey: string }) {
  const [entries, setEntries] = useState<DiaryAdminEntry[] | null>(null)
  const [scheduler, setScheduler] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .diaryAdmin(adminKey)
      .then((doc) => {
        setEntries(doc.entries)
        setScheduler(doc.scheduler)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [adminKey])

  useEffect(load, [load])

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide">いまなにしとる</h2>
      <p className="text-muted-foreground text-xs leading-relaxed">
        時間帯の中のでたらめな時刻に、Android の端末へ「いまなにしとる？」を送るよ。
        答えは次の朝 4 時を過ぎたころに日記にまとめて、日曜にはプロフィールの直し案も作る。
      </p>
      {!scheduler && (
        <p className="text-destructive text-xs leading-relaxed">
          この機械では見回りが止まっとる（DIARY_SCHEDULER）。時刻が来ても聞かんし、日記も書かん。
        </p>
      )}
      {error && <p className="text-destructive leading-relaxed">{error}</p>}
      {!error && entries === null && <p className="text-muted-foreground">読み込み中…</p>}
      {entries?.map((entry) => (
        <DiaryUserRow key={entry.user} adminKey={adminKey} entry={entry} onChanged={load} />
      ))}
    </section>
  )
}

function DiaryUserRow({
  adminKey,
  entry,
  onChanged,
}: {
  adminKey: string
  entry: DiaryAdminEntry
  onChanged: () => void
}) {
  const [draft, setDraft] = useState<DiarySettings>(entry.settings)
  const [busy, setBusy] = useState<'save' | 'ask' | 'profile' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => setDraft(entry.settings), [entry.settings])

  const dirty =
    draft.enabled !== entry.settings.enabled ||
    draft.from !== entry.settings.from ||
    draft.to !== entry.settings.to ||
    draft.count !== entry.settings.count

  async function run(kind: 'save' | 'ask' | 'profile', job: () => Promise<string>) {
    setBusy(kind)
    setNotice(null)
    try {
      setNotice(await job())
      onChanged()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'うまくいかんかった')
    } finally {
      setBusy(null)
    }
  }

  const id = `diary-${entry.user}`

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-enabled`} className="flex items-center gap-2 font-medium">
          <input
            id={`${id}-enabled`}
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            className="accent-primary size-4"
          />
          {entry.user}
        </label>
        <span
          className={`flex items-center gap-1 text-xs ${entry.hasDevice ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          <Smartphone className="size-3.5" />
          {entry.hasDevice ? '端末あり' : '端末なし。オンでも聞かんよ'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <select
          id={`${id}-from`}
          aria-label="聞き始め"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: Number(event.target.value) })}
          className="bg-background rounded-md border px-1.5 py-1 tabular-nums"
        >
          {HOURS_FROM.map((hour) => (
            <option key={hour} value={hour}>
              {hour} 時
            </option>
          ))}
        </select>
        <span>から</span>
        <select
          id={`${id}-to`}
          aria-label="聞き終わり"
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: Number(event.target.value) })}
          className="bg-background rounded-md border px-1.5 py-1 tabular-nums"
        >
          {HOURS_TO.map((hour) => (
            <option key={hour} value={hour}>
              {hour} 時
            </option>
          ))}
        </select>
        <span>までに</span>
        <select
          id={`${id}-count`}
          aria-label="回数"
          value={draft.count}
          onChange={(event) => setDraft({ ...draft, count: Number(event.target.value) })}
          className="bg-background rounded-md border px-1.5 py-1 tabular-nums"
        >
          {COUNTS.map((count) => (
            <option key={count} value={count}>
              {count} 回
            </option>
          ))}
        </select>
        <Button
          size="sm"
          className="ml-auto"
          disabled={!dirty || busy !== null}
          onClick={() =>
            run('save', async () => {
              await api.saveDiarySettings(adminKey, entry.user, draft)
              return '保存したよ'
            })
          }
        >
          保存
        </Button>
      </div>

      {entry.today.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {entry.today.map((slot) => (
            <li
              key={slot.at}
              className={`rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                slot.state === 'pending' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}
            >
              {slot.at} {SLOT_LABEL[slot.state]}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !entry.hasDevice}
          onClick={() =>
            run('ask', async () => {
              const { topic } = await api.askNow(adminKey, entry.user)
              return `送ったよ（${topic.slice(0, 8)}）`
            })
          }
        >
          <MessageCircleQuestion className="size-3.5" />
          {busy === 'ask' ? '書いとる…' : '今すぐ聞く'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            run('profile', async () => {
              const { count } = await api.proposeProfile(adminKey, entry.user)
              return count > 0 ? `直し案を ${count} 件作ったよ` : '直す案は出んかった（答えが二日分ないと作らん）'
            })
          }
        >
          <UserRound className="size-3.5" />
          {busy === 'profile' ? '作っとる…' : '直し案を作る'}
        </Button>
      </div>

      {notice && <p className="text-muted-foreground text-xs">{notice}</p>}
    </div>
  )
}
