import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { FileText, Tags, Trash2, UserRound } from 'lucide-react'
import type { Topic } from '../../shared/types'
import { relativeLabel, topicLabel } from '@/lib/format'
import { useSpace } from '@/lib/space'
import { FamilyEntry } from '@/components/FamilyEntry'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

interface TopicsState {
  topics: Topic[] | null
  error: string | null
  reload: () => void
}

const TopicsContext = createContext<TopicsState | null>(null)

export function useTopics(): TopicsState {
  const ctx = useContext(TopicsContext)
  if (!ctx) throw new Error('スペースの外で useTopics を呼んでいます')
  return ctx
}

export function TopicsProvider({ children }: { children: ReactNode }) {
  const space = useSpace()
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    space.api
      .listTopics()
      .then((list) => {
        space.confirm()
        setTopics(list)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [space])

  useEffect(reload, [reload])

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      reload()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [reload])

  return <TopicsContext.Provider value={{ topics, error, reload }}>{children}</TopicsContext.Provider>
}

function atPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function TopicSidebar() {
  const space = useSpace()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { id } = useParams()
  const { setOpenMobile } = useSidebar()
  const { topics, error, reload } = useTopics()
  const [deleting, setDeleting] = useState<Topic | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const slug = deleting.slug
      await space.api.deleteTopic(slug)
      setDeleting(null)
      if (id === slug) navigate(space.home, { replace: true })
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? space.busyNotice(cause.message) : '削除できませんでした',
      )
    } finally {
      setDeleteBusy(false)
      reload()
    }
  }

  return (
    <>
      <Sidebar>
        {space.kind === 'personal' && (
          <SidebarHeader className="pt-[calc(0.5rem+var(--safe-top))]">
            <div onClick={() => setOpenMobile(false)}>
              <FamilyEntry />
            </div>
          </SidebarHeader>
        )}
        <SidebarContent className={space.kind === 'family' ? 'pt-[calc(0.5rem+var(--safe-top))]' : undefined}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={atPath(pathname, space.tags)}
                    render={<Link to={space.tags} />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Tags />
                    タグ
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {space.profile && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={pathname === space.profile}
                      render={<Link to={space.profile} />}
                      onClick={() => setOpenMobile(false)}
                    >
                      <UserRound />
                      プロフィール
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === space.claude}
                    render={<Link to={space.claude} />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <FileText />
                    CLAUDE.md
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>会話</SidebarGroupLabel>
            <SidebarGroupContent>
              {error && <p className="text-destructive px-2 py-3 text-xs">{error}</p>}
              {topics === null && !error && (
                <p className="text-muted-foreground px-2 py-3 text-xs">読み込み中…</p>
              )}
              {topics?.length === 0 && (
                <p className="text-muted-foreground px-2 py-3 text-xs">まだ会話がないよ。</p>
              )}
              <SidebarMenu>
                {topics?.map((topic) => (
                  <SidebarMenuItem key={topic.slug}>
                    <SidebarMenuButton
                      size="lg"
                      isActive={id === topic.slug}
                      render={<Link to={space.href(topic.slug)} />}
                      onClick={() => setOpenMobile(false)}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center text-lg">
                        {topic.emoji}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col items-start">
                        <span className={topic.name ? '' : 'text-muted-foreground'}>
                          {topicLabel(topic)}
                        </span>
                        <span className="text-muted-foreground text-[11px] font-normal">
                          {relativeLabel(topic.lastMessageAt)}
                        </span>
                      </span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      title={`${topicLabel(topic)} を削除する`}
                      onClick={() => {
                        setDeleteError(null)
                        setDeleting(topic)
                      }}
                    >
                      <Trash2 />
                      <span className="sr-only">削除</span>
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (open || deleteBusy) return
          setDeleting(null)
          setDeleteError(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>会話を削除する</DialogTitle>
            <DialogDescription>
              {deleting ? `「${topicLabel(deleting)}」を削除します。元に戻せません。` : ''}
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-destructive text-sm">{deleteError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleting(null)
                setDeleteError(null)
              }}
              disabled={deleteBusy}
            >
              キャンセル
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
