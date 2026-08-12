/**
 * Service Worker の登録を覚えておくだけの入れ物。
 *
 * 更新の見回りは登録した時点（=画面を開いた時点）にしか走らないので、
 * 開いたままの画面は配信が入れ替わっても古いままになる。古い chunk を
 * 取りに行って失敗したときだけ、ここから確かめ直す。新しいものが見つかれば
 * registerType: 'autoUpdate' の側が画面を読み直す。
 */
let current: ServiceWorkerRegistration | undefined

export function rememberServiceWorker(registration?: ServiceWorkerRegistration): void {
  current = registration
}

export async function checkForNewBuild(): Promise<void> {
  try {
    await current?.update()
  } catch {
    // 圏外などで確かめられないだけ。次に開いたときに拾える。
  }
}
