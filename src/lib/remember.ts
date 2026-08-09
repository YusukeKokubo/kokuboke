const KEY = 'kokuboke:user'

/**
 * 誰の画面かは URL でしか区別していない。その URL 自体が鍵なので、
 * サーバーに名前を尋ねる口は作らない。
 *
 * Android の Chrome はホーム画面に貼るとき manifest の start_url を採るので、
 * 貼った URL の `/user/名前` が落ちて `/` から始まってしまう。そこで、
 * 一度開けた名前だけをその端末に残しておいて、`/` に着いたら送り返す。
 */
export function rememberUser(user: string): void {
  try {
    localStorage.setItem(KEY, user)
  } catch {
    // 保存できない設定でも、URL を直に開けば使える。
  }
}

export function rememberedUser(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
