import { Link, Outlet } from 'react-router-dom'
import { personalHome, useSpace } from '@/lib/space'
import { TopicSidebar, TopicsProvider } from '@/components/TopicSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

/**
 * スペース共通の器。会話一覧は Sidebar。ヘッダと本文は Inset。
 */
export function SpaceShell() {
  return (
    <SidebarProvider>
      <TopicsProvider>
        <TopicSidebar />
        <SidebarInset>
          <div className="flex min-h-svh flex-col">
            <SpaceHeader />
            <Outlet />
          </div>
        </SidebarInset>
      </TopicsProvider>
    </SidebarProvider>
  )
}

function SpaceHeader() {
  const space = useSpace()

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex flex-col gap-2 border-b px-4 py-3 pt-[calc(0.75rem+var(--safe-top))] backdrop-blur">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="shrink-0" />
        <Link to={space.home} className="min-w-0 text-inherit no-underline">
          <h1 className="truncate text-base font-semibold">{space.title}</h1>
          <p className="text-muted-foreground text-xs">{space.subtitle}</p>
        </Link>
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
    </header>
  )
}
