/**
 * 文字をクリップボードへ写す。
 *
 * navigator.clipboard は安全な文脈（https か localhost）でしか使えない。
 * 手元の dev を LAN の IP で開いたときなどは無いので、昔ながらの
 * textarea を選んで execCommand('copy') する手に落とす。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 権限で断られたときも下の手を試す
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // 画面の外に置く。iOS で拡大されんよう字の大きさは 16px 以上にしとく
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.fontSize = '16px'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
