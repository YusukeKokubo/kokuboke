import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { FamilyActivityEntry } from '../../shared/types'
import { api } from '@/lib/api'
import { relativeLabel, topicLabel } from '@/lib/format'

/** 個人のトピック一覧の先頭に出す、家族共有スペースへの入口。 */
export function FamilyEntry() {
  const [entry, setEntry] = useState<FamilyActivityEntry | null | undefined>(undefined)

  useEffect(() => {
    api
      .familyActivity()
      .then((row) => setEntry(row))
      .catch(() => setEntry(null))
  }, [])

  return (
    <Link
      to="/family"
      className="hover:bg-accent flex items-center gap-3 rounded-xl border p-3 transition-colors"
    >
      <span className="bg-secondary flex size-11 shrink-0 items-center justify-center rounded-full text-xl">
        {entry?.emoji || '🏠'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium">家族の共有スペース</span>
          {entry && (
            <span className="text-muted-foreground shrink-0 text-[11px]">
              {relativeLabel(entry.at)}
            </span>
          )}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {entry === undefined
            ? '読み込み中…'
            : entry
              ? `${entry.author ? `${entry.author} · ` : ''}${entry.topicName} / ${topicLabel({ name: entry.subName })} — ${entry.text || (entry.imageCount > 0 ? '（画像）' : '（空）')}`
              : 'みんなのメモや買い物リストを置く場所'}
        </span>
      </span>
    </Link>
  )
}
