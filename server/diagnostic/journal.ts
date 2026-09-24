import fs from 'node:fs'
import path from 'node:path'

/**
 * 手元に最近の分を持ちつつ、JSON Lines のファイルにも書き足す入れ物。
 * コンテナを入れ替えても前の分が見えるよう、開いたときにファイルの末尾を読み戻す。
 *
 * ファイルは上限を超えたら一世代だけ `.1` に退かせる。ログの書き込みは
 * 一回あたり小さく回数も少ないので、同期で書いて順番の心配をなくしている。
 */
export class Journal<T> {
  private items: T[] = []
  private file: string | null = null
  private size = 0

  constructor(
    private readonly name: string,
    private readonly keep: number,
    private readonly maxBytes: number,
  ) {}

  /**
   * 書き出し先を決めて、前回までの末尾を読み戻す。呼ぶまではメモリだけで持つ。
   * 開けなければ理由を返す。サーバーは止めず、メモリの分だけで続ける。
   */
  open(dir: string): string | null {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${this.name}.jsonl`)
      const restored = [...readTail(`${file}.1`, this.maxBytes), ...readTail(file, this.maxBytes)]
        .map((line) => parse<T>(line))
        .filter((item): item is T => item !== null)
      this.items = [...restored, ...this.items].slice(-this.keep)
      this.size = fileSize(file)
      this.file = file
      return null
    } catch (error) {
      return `${this.name} を ${dir} に書けません: ${String(error)}`
    }
  }

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.keep) this.items.splice(0, this.items.length - this.keep)
    if (!this.file) return

    const line = `${JSON.stringify(item)}\n`
    const bytes = Buffer.byteLength(line)
    try {
      if (this.size > 0 && this.size + bytes > this.maxBytes) {
        fs.renameSync(this.file, `${this.file}.1`)
        this.size = 0
      }
      fs.appendFileSync(this.file, line)
      this.size += bytes
    } catch {
      // ここで console を使うと、ログを受ける側が自分を呼び直してしまう。
    }
  }

  /** 古い順。 */
  list(): T[] {
    return [...this.items]
  }

  /** 書き出し先。開いていなければ null。 */
  get path(): string | null {
    return this.file
  }
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/** ファイルの末尾から最大 bytes 分を行に分けて返す。途中で切れた先頭の行は捨てる。 */
function readTail(file: string, bytes: number): string[] {
  let fd: number
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return []
  }
  try {
    const size = fs.fstatSync(fd).size
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split('\n')
    if (length < size) lines.shift()
    return lines.filter(Boolean)
  } finally {
    fs.closeSync(fd)
  }
}

function parse<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T
  } catch {
    return null
  }
}
