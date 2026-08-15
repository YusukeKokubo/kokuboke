import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, FileText, MessageSquarePlus, MoreHorizontal, Tags, Trash2, UserRound } from 'lucide-react'
import type { Topic } from '../../shared/types'
import { topicLabel } from '@/lib/format'
import { familySpace, personalSpace, useSpace, type Space } from '@/lib/space'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

interface TopicsState {
  personal: Topic[] | null
  family: Topic[] | null
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
  const user = space.owner ?? space.author ?? ''
  const personal = useMemo(() => (user ? personalSpace(user) : null), [user])
  const family = useMemo(() => (user ? familySpace(user) : null), [user])
  const [personalTopics, setPersonalTopics] = useState<Topic[] | null>(null)
  const [familyTopics, setFamilyTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!personal || !family) return
    Promise.all([personal.api.listTopics(), family.api.listTopics()])
      .then(([mine, shared]) => {
        space.confirm()
        setPersonalTopics(mine)
        setFamilyTopics(shared)
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [personal, family, space])

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

  return (
    <TopicsContext.Provider
      value={{ personal: personalTopics, family: familyTopics, error, reload }}
    >
      {children}
    </TopicsContext.Provider>
  )
}

function atPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function TopicSidebar() {
  const current = useSpace()
  const user = current.owner ?? current.author ?? ''
  const personal = useMemo(() => (user ? personalSpace(user) : null), [user])
  const family = useMemo(() => (user ? familySpace(user) : null), [user])
  const { personal: personalTopics, family: familyTopics, error, reload } = useTopics()
  const [deleting, setDeleting] = useState<{ topic: Topic; space: Space } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { id } = useParams()

  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const { topic, space } = deleting
      await space.api.deleteTopic(topic.slug)
      setDeleting(null)
      if (current.docKey() === space.docKey() && id === topic.slug) {
        navigate(space.home, { replace: true })
      }
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? deleting.space.busyNotice(cause.message) : '削除できませんでした',
      )
    } finally {
      setDeleteBusy(false)
      reload()
    }
  }

  return (
    <>
      <Sidebar>
        <SidebarContent className="pt-[calc(0.5rem+var(--safe-top))]">
          {family && (
            <SpaceSection
              label="家族"
              space={family}
              topics={familyTopics}
              error={error}
              onDelete={(topic) => {
                setDeleteError(null)
                setDeleting({ topic, space: family })
              }}
            />
          )}
          {personal && (
            <SpaceSection
              label={personal.title}
              space={personal}
              topics={personalTopics}
              error={error}
              onDelete={(topic) => {
                setDeleteError(null)
                setDeleting({ topic, space: personal })
              }}
            />
          )}
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
              {deleting ? `「${topicLabel(deleting.topic)}」を削除します。元に戻せません。` : ''}
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

function SpaceSection({
  label,
  space,
  topics,
  error,
  onDelete,
}: {
  label: string
  space: Space
  topics: Topic[] | null
  error: string | null
  onDelete: (topic: Topic) => void
}) {
  const { pathname } = useLocation()
  const { id } = useParams()
  const { isMobile, setOpenMobile } = useSidebar()
  const here = atPath(pathname, space.home)

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === space.home}
              render={<Link to={space.home} />}
              onClick={() => setOpenMobile(false)}
            >
              <MessageSquarePlus />
              新しい会話
            </SidebarMenuButton>
          </SidebarMenuItem>
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

        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroupLabel render={<CollapsibleTrigger />} className='w-full'>
            会話
            <ChevronDown className="ml-auto transition-transform group-data-open/collapsible:rotate-180" />
          </SidebarGroupLabel>
          <CollapsibleContent>
            {error && <p className="text-destructive px-2 py-3 text-xs">{error}</p>}
            {topics === null && !error && (
              <p className="text-muted-foreground px-2 py-3 text-xs">読み込み中…</p>
            )}
            {topics?.length === 0 && (
              <p className="text-muted-foreground px-2 py-3 text-xs">まだ会話がないよ。</p>
            )}
            <SidebarMenu>
              {topics?.map((topic) => (
                <SidebarMenuItem key={`${space.docKey()}:${topic.slug}`}>
                  <SidebarMenuButton
                    isActive={here && id === topic.slug}
                    render={<Link to={space.href(topic.slug)} />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <span className={topic.name ? '' : 'text-muted-foreground'}>
                      {topicLabel(topic)}
                    </span>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<SidebarMenuAction showOnHover />}>
                      <MoreHorizontal />
                      <span className="sr-only">{topicLabel(topic)} の操作</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-48"
                      side={isMobile ? 'bottom' : 'right'}
                      align={isMobile ? 'end' : 'start'}
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(topic)}>
                          <Trash2 />
                          削除
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
