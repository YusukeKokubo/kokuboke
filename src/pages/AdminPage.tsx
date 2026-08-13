import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, Download, ImageIcon, RefreshCw } from 'lucide-react'
import type { ActivityEntry, UpdateStatus } from '../../shared/types'
import { api } from '@/lib/api'
import { relativeLabel, topicLabel } from '@/lib/format'
import { topicHref } from '@/lib/route'
import { Button } from '@/components/ui/button'

const KEY = 'kokuboke:admin'

/**
 * 鍵は URL の `?key=` で渡す。一度開けたら端末に残すので、PWA として
 * ホーム画面から開き直しても効く。鍵が合わなければサーバーは 404 を返し、
 * この画面があること自体が見えない。
 */
function rememberedKey(fromUrl: string | null): string {
  try {
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl)
      return fromUrl
    }
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return fromUrl ?? ''
  }
}

type Phase = 'idle' | 'requested' | 'waiting' | 'done' | 'failed'

export default function AdminPage() {
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
          <p className="text-muted-foreground text-xs">管理</p>
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
                    to={topicHref(entry.user, { kind: 'child', topic: entry.topic, sub: entry.sub })}
                    className="hover:bg-muted/50 -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-2.5"
                  >
                    <div className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate">
                        {entry.user}
                        <span className="mx-1.5 opacity-40">·</span>
                        {entry.emoji} {entry.topicName} / {topicLabel({ name: entry.subName })}
                      </span>
                      <span className="shrink-0">{relativeLabel(entry.at)}</span>
                    </div>
                    <p className="flex items-center gap-1.5 truncate leading-relaxed">
                      {entry.text || (entry.imageCount > 0 ? '（画像）' : '（空）')}
                      {entry.imageCount > 0 && (
                        <ImageIcon className="text-muted-foreground size-3.5 shrink-0" />
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
