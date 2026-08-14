import { Navigate, useLocation } from 'react-router-dom'
import { rememberedUser } from '@/lib/remember'

/** 共有スペースは author が要る。覚えが無ければ入口へ送り、戻り先を渡す。 */
export function FamilyGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const remembered = rememberedUser()

  if (!remembered) {
    const next = encodeURIComponent(location.pathname)
    return <Navigate to={`/user?next=${next}`} replace />
  }

  return children
}
