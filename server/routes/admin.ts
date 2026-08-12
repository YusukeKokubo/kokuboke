import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ActivityEntry, UpdateResult, UpdateStatus } from '../../shared/types'
import { config } from '../config'
import { listRecentActivity } from '../store/activity'

export const admin = new Hono()

/**
 * 鍵が合わないときは 401 ではなく 404 を返す。誰の画面かを URL でしか分けて
 * いないアプリなので、管理の口があること自体を見せない。鍵を決めていない機械
 * （手元や、.env に ADMIN_TOKEN が無い場合）では口ごと閉じる。
 */
admin.use('/api/admin/*', async (c, next) => {
  if (!config.adminToken) throw new HTTPException(404, { message: 'ページが見つかりません' })

  const given = c.req.header('x-admin-token') ?? c.req.query('key') ?? ''
  if (given !== config.adminToken) {
    throw new HTTPException(404, { message: 'ページが見つかりません' })
  }
  return next()
})

interface Compare {
  ahead_by?: number
  commits?: Array<{ sha?: string; commit?: { message?: string } }>
  files?: Array<{ filename?: string }>
}

/**
 * ワークフローの paths-ignore と同じ範囲。ここだけの差ならイメージは作られて
 * いないので、待たせても入れ替わらない。合わせて直すこと。
 */
function docsOnly(files: string[]): boolean {
  return files.length > 0 && files.every((f) => f.endsWith('.md') || f.startsWith('docs/'))
}

/**
 * 動いているイメージのコミットと main を GitHub に見比べてもらう。
 * 公開リポジトリなので認証は要らない。匿名の上限は 1 時間 60 回で、
 * 画面を開いたときに 1 回叩くだけなら足りる。
 */
async function compare(commit: string): Promise<UpdateStatus> {
  const base: UpdateStatus = {
    commit,
    latest: null,
    behind: null,
    commits: [],
    composeChanged: false,
    docsOnly: false,
    canUpdate: Boolean(config.watchtowerUrl && config.watchtowerToken),
  }

  const url = `https://api.github.com/repos/${config.githubRepo}/compare/${commit}...main`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'kokuboke' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { ...base, error: 'GitHub に繋がりませんでした' }
  }

  if (!res.ok) {
    // 焼き込まれたコミットが GitHub 側に無い（履歴を書き換えたなど）と 404 になる。
    const reason = res.status === 404 ? 'このイメージの元コミットが見つかりません' : `GitHub が ${res.status} を返しました`
    return { ...base, error: reason }
  }

  const body = (await res.json()) as Compare
  const commits = body.commits ?? []
  const files = (body.files ?? []).map((file) => file.filename ?? '').filter(Boolean)

  return {
    ...base,
    latest: commits.at(-1)?.sha ?? commit,
    behind: body.ahead_by ?? commits.length,
    // 新しいものを先に見せたいので、GitHub が返す古い順をひっくり返す。
    commits: commits
      .map((entry) => (entry.commit?.message ?? '').split('\n')[0]?.trim() ?? '')
      .filter(Boolean)
      .reverse(),
    composeChanged: files.includes('docker-compose.yml'),
    docsOnly: docsOnly(files),
  }
}

admin.get('/api/admin/status', async (c) => {
  if (!config.appCommit) {
    // 手元で直に動かしたときはコミットが焼き込まれていない。比べる相手が無い。
    return c.json<UpdateStatus>({
      commit: null,
      latest: null,
      behind: null,
      commits: [],
      composeChanged: false,
      docsOnly: false,
      canUpdate: false,
      error: 'イメージから起動していないので更新は確認できません',
    })
  }

  return c.json(await compare(config.appCommit))
})

/**
 * 本人の送信を横断して新しい順に返す。詳細は各会話画面で見る前提なので、
 * ここは抜粋と行き先だけでよい。
 */
admin.get('/api/admin/activity', async (c) => {
  const raw = Number(c.req.query('limit') ?? 50)
  const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.trunc(raw))) : 50
  const entries = await listRecentActivity(limit)
  return c.json<{ entries: ActivityEntry[] }>({ entries })
})

admin.post('/api/admin/update', async (c) => {
  if (!config.watchtowerUrl || !config.watchtowerToken) {
    throw new HTTPException(503, { message: '更新の引き金が設定されていません' })
  }

  // 差し替えるものがあれば、頼んだ相手が頼んだ当のコンテナを止めにかかるので、
  // ここは返事を受け取れずに終わる。逆に返事が返ってきたときは中身が使える。
  // 何も差し替わらなかった（updated が 0）と分かれば、画面を三分待たせずに済む。
  // POST であること。GET だと 405 になる（元家の watchtower は GET でも
  // 受けていたが、手入れの続いている分かれ先では通らない）。
  let res: Response
  try {
    res = await fetch(`${config.watchtowerUrl}/v1/update`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.watchtowerToken}` },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (cause) {
    console.error('[admin] 更新の返事が返りませんでした', cause)
    return c.json<UpdateResult>({ replacing: true, summary: null }, 202)
  }

  if (!res.ok) {
    throw new HTTPException(502, { message: `Watchtower が ${res.status} を返しました` })
  }

  const body = (await res.json()) as { summary?: UpdateResult['summary'] }
  return c.json<UpdateResult>({ replacing: false, summary: body.summary ?? null })
})
