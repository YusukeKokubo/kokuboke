import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, Outlet } from 'react-router-dom'
import { personalHome, useSpace } from '@/lib/space'
import { TopicSidebar, TopicsProvider } from '@/components/TopicSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

const HeaderSlotContext = createContext<{
  anchor: HTMLElement | null
  occupy: () => void
  release: () => void
} | null>(null)

/** スペース名の代わりに、その画面の見出しを固定ヘッダへ出す。 */
export function SpaceHeaderSlot({ children }: { children: ReactNode }) {
  const ctx = useContext(HeaderSlotContext)
  if (!ctx) throw new Error('スペースの外で SpaceHeaderSlot を使っています')
  const { anchor, occupy, release } = ctx

  useLayoutEffect(() => {
    occupy()
    return () => release()
  }, [occupy, release])

  if (!anchor) return null
  return createPortal(children, anchor)
}

/**
 * スペース共通の器。会話一覧は Sidebar。ヘッダと本文は Inset。
 */
export function SpaceShell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [occupied, setOccupied] = useState(false)
  const occupy = useCallback(() => setOccupied(true), [])
  const release = useCallback(() => setOccupied(false), [])
  const slot = useMemo(() => ({ anchor, occupy, release }), [anchor, occupy, release])

  return (
    <SidebarProvider>
      <TopicsProvider>
        <TopicSidebar />
        <SidebarInset>
          <HeaderSlotContext.Provider value={slot}>
            <div className="flex min-h-svh flex-col">
              <SpaceHeader onAnchor={setAnchor} occupied={occupied} />
              <Outlet />
            </div>
          </HeaderSlotContext.Provider>
        </SidebarInset>
      </TopicsProvider>
    </SidebarProvider>
  )
}

function SpaceHeader({
  onAnchor,
  occupied,
}: {
  onAnchor: (el: HTMLElement | null) => void
  occupied: boolean
}) {
  const space = useSpace()

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex flex-col gap-2 border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))] backdrop-blur">
      <div className="flex items-start gap-2">
        <SidebarTrigger className="mt-0.5 shrink-0" />
        <div ref={onAnchor} className="min-w-0 flex-1">
          {!occupied && (
            <Link to={space.home} className="min-w-0 text-inherit no-underline">
              <h1 className="truncate text-base font-semibold">{space.title}</h1>
              <p className="text-muted-foreground text-xs">{space.subtitle}</p>
            </Link>
          )}
        </div>
      </div>

      {space.kind === 'family' && space.author && !occupied && (
        <div className="flex items-center justify-end gap-2">
          <Link
            to={personalHome(space.author)}
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
          >
            自分の会話へ
          </Link>
        </div>
      )}
    </header>
  )
}
