import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/**
 * 開いたままの画面を、新しい配信に載せ替える。
 *
 * Service Worker が更新を見に行くのは登録した時点（=画面を開いた時点）だけ。
 * ホーム画面から開いた PWA も Android の殻も、一度開くと何日もそのまま生き続けるので、
 * イメージを差し替えても古い画面が残る。その画面が頼むファイル名はもう無いので、
 * 取りに行った時点で 404 になる。
 *
 * 使っている最中に読み直すと返事の流れが切れる。確かめるのは、しばらく離れて
 * 戻ってきたときと、消えたファイルを踏んでしまったときだけにする。
 */

/** これだけ離れていれば、話の途中ではないと見なす。 */
const AWAY_MS = 30 * 60 * 1000

let registration: ServiceWorkerRegistration | undefined
let leftAt = 0

export function rememberServiceWorker(found?: ServiceWorkerRegistration): void {
  registration = found
}

/** 新しい配信が出ていないか確かめる。あれば Service Worker が入れ替わる。 */
export async function checkForNewBuild(): Promise<void> {
  if (!registration) return
  try {
    await registration.update()
  } catch {
    // 圏外などで確かめられないだけ。次の機会に拾う。
  }
}

/**
 * 見張りを始める。呼ぶのは起動時に一度だけ。
 *
 * 入れ替わりの検知は controllerchange で自分で見る。vite-plugin-pwa の
 * autoUpdate も似たことをするが、あちらが読み直すのは自分が登録した
 * Service Worker が上がったときだけで、後から外で交代した回は取りこぼす。
 */
export function watchForNewBuild(): void {
  watchHandover()

  if (Capacitor.isNativePlatform()) {
    // WebView の visibilitychange は殻の作りによって出ないことがある。
    // 前後の切り替えは App プラグインの方が確かなので、そちらを聞く。
    void App.addListener('appStateChange', ({ isActive }) => came(isActive))
    return
  }
  document.addEventListener('visibilitychange', () => came(!document.hidden))
}

function came(active: boolean): void {
  if (!active) {
    leftAt = Date.now()
    return
  }
  if (!leftAt || Date.now() - leftAt < AWAY_MS) return
  leftAt = 0

  // Service Worker の居ない殻には確かめる口が無いので、素直に読み直す。
  // index.html は no-cache で返しているので、変わっていなければ 304 で済む。
  if (registration) void checkForNewBuild()
  else window.location.reload()
}

function watchHandover(): void {
  if (!('serviceWorker' in navigator)) return

  // 初めて Service Worker が付くだけの回は読み直さない。中身は今の画面と同じもの。
  let controlled = !!navigator.serviceWorker.controller
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true
      return
    }
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}
