import { HTTPException } from 'hono/http-exception'
import { config } from '../config'

/**
 * Claude Code は 1 プロセスあたり数百 MB 使う。NAS のメモリを守るため、
 * 全体の同時実行数を絞り、同じユーザーの多重送信は待たせずに弾く。
 */
export class Limiter {
  private active = 0
  private waiting: Array<() => void> = []
  private busyUsers = new Set<string>()

  constructor(private readonly max: number) {}

  async acquire(user: string): Promise<() => void> {
    if (this.busyUsers.has(user)) {
      throw new HTTPException(409, { message: '前の返答をまだ書いています' })
    }
    this.busyUsers.add(user)

    try {
      if (this.active >= this.max) {
        await new Promise<void>((resolve) => this.waiting.push(resolve))
      }
    } catch (error) {
      this.busyUsers.delete(user)
      throw error
    }

    this.active++

    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.busyUsers.delete(user)
      this.waiting.shift()?.()
    }
  }

  /**
   * 先客がいれば終わるまで待ってから枠を取る。
   * 命名のように「画面が閉じても続け、あとから結果だけ取りに来る」用途向け。
   * 発言の送信は待たせずに弾くので、そちらは acquire のまま。
   */
  async acquireWhenFree(user: string): Promise<() => void> {
    for (;;) {
      try {
        return await this.acquire(user)
      } catch (error) {
        if (!(error instanceof HTTPException) || error.status !== 409) throw error
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
    }
  }

  /**
   * その人がいま返事を書いているか。枠は取らず、待たない。
   * 削除のように「忙しかったら弾くだけ」の用途向け。acquire とは別口。
   */
  isBusy(user: string): boolean {
    return this.busyUsers.has(user)
  }

  get stats() {
    return { active: this.active, waiting: this.waiting.length, max: this.max }
  }
}

export const limiter = new Limiter(config.maxConcurrent)
