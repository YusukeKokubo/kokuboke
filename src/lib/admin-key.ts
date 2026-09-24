const KEY = 'kokuboke:admin'

/**
 * 管理の鍵は URL の `?key=` で渡す。一度開けたら端末に残すので、PWA として
 * ホーム画面から開き直しても効く。鍵が合わなければサーバーは 404 を返し、
 * 画面があること自体が見えない。管理画面と診断の画面で同じ鍵を使う。
 */
export function rememberedKey(fromUrl: string | null): string {
  try {
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl)
      return fromUrl
    }
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return fromUrl ?? ''
  }
}
