import { useEffect } from 'react'

const APP = 'kokuboke'

/** タブの見出し。画面が外れたらアプリ名に戻す。 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP
    return () => {
      document.title = APP
    }
  }, [title])
}
