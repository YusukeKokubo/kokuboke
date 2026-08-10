import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { config, assertConfig } from './config'
import { limiter } from './agent/queue'
import { admin } from './routes/admin'
import { media } from './routes/media'
import { messages } from './routes/messages'
import { summary } from './routes/summary'
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
app.route('/', summary)
app.route('/', media)

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }
  console.error('[unhandled]', error)
  return c.json({ error: 'サーバー側で問題が起きました' }, 500)
})

if (config.isProduction) {
  const clientDir = path.resolve(import.meta.dirname, '../client')
  const root = path.relative(process.cwd(), clientDir)

  app.use('/*', serveStatic({ root }))
  // SPA なので、実ファイルに当たらないパスは index.html に落とす。
  app.get('*', serveStatic({ path: path.join(root, 'index.html') }))
}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`kokuboke listening on http://127.0.0.1:${info.port}`)
  console.log(`  data dir : ${config.dataDir}`)
  console.log(`  users    : ${config.users.join(', ')}`)
  console.log(`  model    : ${config.claudeModel} (summary: ${config.summaryModel})`)
})
