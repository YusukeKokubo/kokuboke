import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * cursor-agent はヘッドレス（--print）でもウェブ検索・ページ取得のたびに
 * 承認を求める。答える人がいないので、既定では即 User Rejected になる。
 *
 * ページ取得を通す道は --force だけで、permissions の許可リストは
 * この経路では見ていない（2026.08.04-aaa8809 で確認）。検索の方は
 * cli-config.json の autoAcceptWebSearch を見るので、そこだけ立てておく。
 * このファイルは設定用のボリュームの中にあり、イメージには焼けない。
 */
function configFile(): string {
  const explicit = process.env.CURSOR_CONFIG_DIR?.trim()
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  const dir = explicit || (xdg ? path.join(xdg, 'cursor') : path.join(os.homedir(), '.cursor'))
  return path.join(dir, 'cli-config.json')
}

async function apply(): Promise<void> {
  const file = configFile()
  // ログイン前のコンテナにはまだ無い。読めなければ次の起動でまた試す。
  const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>
  if (parsed.autoAcceptWebSearch === true) return

  parsed.autoAcceptWebSearch = true
  // CLI 側も一時ファイルからの rename で書き換える。同じやり方に揃えて、
  // 書きかけの形を相手に見せない。
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, file)
}

let settled = false
let inFlight: Promise<void> | null = null

/** cursor-agent を起動する前に一度だけ呼ぶ。立っていれば何もしない。 */
export function ensureWebSearchApproved(): Promise<void> {
  if (settled) return Promise.resolve()

  inFlight ??= apply().then(
    () => {
      settled = true
      inFlight = null
    },
    (error: unknown) => {
      // 設定を書けなくても会話そのものは続く。検索が拒否されるだけ。
      console.warn('[cursor] ウェブ検索の許可を書けませんでした:', String(error))
      inFlight = null
    },
  )

  return inFlight
}
