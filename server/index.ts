import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config, assertConfig } from './config'

assertConfig()

const app = new Hono()

app.use('*', logger())

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    users: config.users,
    dataDir: config.dataDir,
    maxConcurrent: config.maxConcurrent,
  }),
)

// Step 3 でここに topics / messages / summary / media のルートを足す。

if (config.isProduction) {
  const clientDir = path.resolve(import.meta.dirname, '../client')

  app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), clientDir) }))
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), clientDir) }))

  // SPA なので、API と実ファイル以外は index.html に落とす。
  app.get('*', serveStatic({ path: path.relative(process.cwd(), path.join(clientDir, 'index.html')) }))
}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`kokuboke listening on http://127.0.0.1:${info.port}`)
  console.log(`  data dir : ${config.dataDir}`)
  console.log(`  users    : ${config.users.join(', ')}`)
})
