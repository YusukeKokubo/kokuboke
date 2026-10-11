import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { applyProfileChanges, charCount, PROFILE_LIMIT } from '../../shared/profile-changes'
import type { ProfileChange, ProfileProposal } from '../../shared/types'
import { useSpace } from '@/lib/space'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const TYPE_LABEL: Record<ProfileChange['type'], string> = { add: '足す', replace: '直す', remove: '消す' }

function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${month}/${day}`
}

/**
 * 「いまなにしとる」の答えから作った profile.md の直し案。週に一度、日曜の朝に届く。
 * どれを入れるかは本人が選び、選ばなかった案は見送りとして次の案づくりに渡る。
 * 入れたあとの字数が上限を超える組み合わせは選べない。
 */
export function ProfileProposalCard({ source, onApplied }: { source: string; onApplied: () => void }) {
  const space = useSpace()
  const [proposal, setProposal] = useState<ProfileProposal | null>(null)
  const [profile, setProfile] = useState('')
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([space.api.getProfileProposal(), space.api.getProfile()])
      .then(([next, text]) => {
        if (cancelled) return
        setProposal(next)
        setProfile(text)
        setSkipped(new Set())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [space, source])

  const picked = useMemo(
    () => proposal?.changes.filter((change) => !skipped.has(change.id)) ?? [],
    [proposal, skipped],
  )
  const limit = proposal?.limit || PROFILE_LIMIT
  const after = useMemo(() => charCount(applyProfileChanges(profile, picked)), [profile, picked])
  const over = after > limit

  if (!proposal) return null

  async function send(ids: string[]) {
    setSending(true)
    setError(null)
    try {
      await space.api.applyProfileProposal(ids)
      setProposal(null)
      onApplied()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '入れられませんでした')
    } finally {
      setSending(false)
    }
  }

  function toggle(id: string) {
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="bg-card flex flex-col overflow-hidden rounded-2xl border">
      <div className="flex flex-col gap-0.5 px-3.5 pt-3 pb-1">
        <h2 className="text-[13px] font-semibold">今週の答えからの直し案</h2>
        <p className="text-muted-foreground text-xs">入れないものはチェックを外してね。外したものは次から出さないよ。</p>
      </div>
      <ul className="flex flex-col">
        {proposal.changes.map((change) => (
          <li key={change.id}>
            <label className="flex cursor-pointer items-start gap-2.5 px-3.5 py-2">
              <input
                type="checkbox"
                checked={!skipped.has(change.id)}
                onChange={() => toggle(change.id)}
                disabled={sending}
                className="accent-primary mt-1 size-4 shrink-0"
              />
              <span className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-relaxed break-words">
                <span className="text-muted-foreground text-[11px]">{TYPE_LABEL[change.type]}</span>
                {change.type === 'replace' && (
                  <span className="text-destructive font-mono line-through decoration-1">{change.from}</span>
                )}
                <span
                  className={cn(
                    'font-mono',
                    change.type === 'remove' ? 'text-destructive line-through decoration-1' : 'font-medium',
                  )}
                >
                  {change.type === 'replace' ? change.to : change.text}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  {change.type === 'remove'
                    ? change.reason
                    : `${change.dates.map(shortDate).join('・')} の答えから`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 px-3.5 pt-1 pb-3.5">
        <p className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
          入れたあと {after.toLocaleString()} / {limit.toLocaleString()} 字
          {over && '。上限を超えるで、消す案を足すか、足す案を外してね'}
        </p>
        {error && <p className="text-destructive text-xs">{error}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={sending} onClick={() => send([])}>
            全部見送る
          </Button>
          <Button
            className="flex-1"
            disabled={sending || picked.length === 0 || over}
            onClick={() => send(picked.map((change) => change.id))}
          >
            {sending && <Loader2 className="size-4 animate-spin" />}
            選んだ {picked.length} 件を入れる
          </Button>
        </div>
      </div>
    </section>
  )
}
