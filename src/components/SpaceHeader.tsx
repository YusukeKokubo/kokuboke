import { createContext, useContext, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { personalHome, useSpace } from '@/lib/space'
import { TopicSidebar, TopicsProvider } from '@/components/TopicSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

const HeaderAnchorContext = createContext<HTMLElement | null>(null)

/** 会話画面が、スペース名の代わりに見出しを差し込む先。 */
export function useHeaderAnchor(): HTMLElement | null {
  return useContext(HeaderAnchorContext)
}

/**
 * スペース共通の器。会話一覧は Sidebar。ヘッダと本文は Inset。
 */
export function SpaceShell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  return (
    <SidebarProvider>
      <TopicsProvider>
        <TopicSidebar />
        <SidebarInset>
          <HeaderAnchorContext.Provider value={anchor}>
            <div className="flex min-h-svh flex-col">
              <SpaceHeader onAnchor={setAnchor} />
              <Outlet />
            </div>
          </HeaderAnchorContext.Provider>
        </SidebarInset>
      </TopicsProvider>
    </SidebarProvider>
  )
}

function SpaceHeader({ onAnchor }: { onAnchor: (el: HTMLElement | null) => void }) {
  const space = useSpace()
  const { id } = useParams()
  const onChat = Boolean(id)

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex flex-col gap-2 border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))] backdrop-blur">
      <div className="flex items-start gap-2">
        <SidebarTrigger className="mt-0.5 shrink-0" />
        <div ref={onAnchor} className="min-w-0 flex-1">
          {!onChat && (
            <Link to={space.home} className="min-w-0 text-inherit no-underline">
              <h1 className="truncate text-base font-semibold">{space.title}</h1>
              <p className="text-muted-foreground text-xs">{space.subtitle}</p>
            </Link>
          )}
        </div>
      </div>

      {space.kind === 'family' && space.author && !onChat && (
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
