import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { rememberUser, rememberedUser } from '@/lib/remember'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
  onChange?: (name: string) => void
}

/** 共有スペースで誰として書くか。切り替えたら端末に覚え直す。 */
export function AuthorPicker({ className, onChange }: Props) {
  const [users, setUsers] = useState<string[]>([])
  const [author, setAuthor] = useState(() => rememberedUser() ?? '')

  useEffect(() => {
    api
      .health()
      .then((health) => setUsers(health.users))
      .catch(() => {})
  }, [])

  return (
    <label className={cn('flex min-w-0 items-center gap-2 text-xs', className)}>
      <span className="text-muted-foreground shrink-0">書く人</span>
      <select
        value={author}
        onChange={(event) => {
          const name = event.target.value
          rememberUser(name)
          setAuthor(name)
          onChange?.(name)
        }}
        className="bg-background border-input focus-visible:ring-ring min-w-0 max-w-[8rem] truncate rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-2"
        aria-label="誰として書くか"
      >
        {author && !users.includes(author) && <option value={author}>{author}</option>}
        {users.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </label>
  )
}
