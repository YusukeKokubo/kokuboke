import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { FileText, Plus, Tags, UserRound } from 'lucide-react'
import { personalHome, useSpace } from '@/lib/space'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'

function atPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * スペース共通のヘッダ。一覧・会話・タグ・文書で同じものを出す。
 */
export function SpaceShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <SpaceHeader />
      <Outlet />
    </div>
  )
}

function SpaceHeader() {
  const space = useSpace()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const onTags = atPath(pathname, space.tags)
  const onProfile = !!space.profile && pathname === space.profile
  const onClaude = pathname === space.claude

  async function start() {
    if (starting) return
    setStarting(true)
    setNotice(null)
    try {
      const topic = await space.api.createTopic({})
      navigate(space.href(topic.slug))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '始められませんでした')
      setStarting(false)
    }
  }

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex flex-col gap-2 border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))] backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <Link to={space.home} className="min-w-0 text-inherit no-underline">
          <h1 className="truncate text-base font-semibold">{space.title}</h1>
          <p className="text-muted-foreground text-xs">{space.subtitle}</p>
        </Link>
        <ButtonGroup className="shrink-0">
          <Button variant={onTags ? 'secondary' : 'outline'} size="sm" render={<Link to={space.tags} />}>
            <Tags />
            タグ
          </Button>
          {space.profile && (
            <Button
              variant={onProfile ? 'secondary' : 'outline'}
              size="sm"
              render={<Link to={space.profile} />}
            >
              <UserRound />
              プロフィール
            </Button>
          )}
          <Button variant={onClaude ? 'secondary' : 'outline'} size="sm" render={<Link to={space.claude} />}>
            <FileText />
            CLAUDE.md
          </Button>
          <Button size="sm" onClick={() => void start()} disabled={starting}>
            <Plus />
            追加
          </Button>
        </ButtonGroup>
      </div>

      {space.kind === 'family' && space.author && (
        <div className="flex items-center justify-end gap-2">
          <Link
            to={personalHome(space.author)}
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
          >
            自分の会話へ
          </Link>
        </div>
      )}

      {notice && <p className="text-destructive text-xs">{notice}</p>}
    </header>
  )
}
