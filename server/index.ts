import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { config, assertConfig } from './config'
import { AppError } from './errors'
import { limiter } from './agent/queue'
import { admin } from './routes/admin'
import { docs } from './routes/docs'
import { media } from './routes/media'
import { messages } from './routes/messages'
import { tags } from './routes/tags'
import { topics } from './routes/topics'
import { ensureAllUsers } from './store/user'

assertConfig()
await ensureAllUsers()

const app = new Hono()

app.use('*', logger())

// commit を混ぜてあるのは、更新を頼んだ画面がここを叩き直して、
// 別のコミットで戻ってきたことを確かめるため。
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    users: config.users,
    queue: limiter.stats,
    commit: config.appCommit || null,
  }),
)

app.route('/', admin)
app.route('/', topics)
app.route('/', messages)
app.route('/', tags)
app.route('/', docs)
app.route('/', media)

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ error: error.message }, error.status)
  }
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }
  console.error('[unhandled]', error)
  return c.json({ error: 'サーバー側で問題が起きました' }, 500)
})

if (config.isProduction) {
  const clientDir = path.resolve(import.meta.dirname, '../client')
  const root = path.relative(process.cwd(), clientDir)

  // /assets/ の中は名前にハッシュが入るので中身が変わらない。それ以外
  // （index.html・sw.js・manifest）は毎回確かめさせる。古い index.html を
  // 握られると、消えた chunk を追い続ける画面ができてしまう。
  const cacheHeader = (_file: string, c: Context) => {
    c.header(
      'Cache-Control',
      c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    )
  }

  app.use('/*', serveStatic({ root, onFound: cacheHeader }))

  // 取りこぼした /assets/ は 404 で返す。JavaScript を頼まれて index.html を
  // 返すと MIME 違いで読み込みごと失敗し、何が起きたのか分からなくなる。
  app.get('/assets/*', (c) => c.text('Not Found', 404))

  // SPA なので、実ファイルに当たらないパスは index.html に落とす。
  app.get('*', serveStatic({ path: path.join(root, 'index.html'), onFound: cacheHeader }))
}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`kokuboke listening on http://127.0.0.1:${info.port}`)
  console.log(`  data dir : ${config.dataDir}`)
  console.log(`  users    : ${config.users.join(', ')}`)
  console.log(`  model    : ${config.defaultEngine} / ${config.claudeModel} · ${config.cursorModel}`)
})
