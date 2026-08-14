import type { Context, Hono } from 'hono'
import { readText } from './body'

/** profile / CLAUDE.md / summary.md の GET/PUT。キーと読み書きだけ渡せば足りる。 */
export function markdownDoc<K extends string>(
  app: Hono,
  paths: string | string[],
  key: K,
  read: (c: Context) => Promise<string>,
  write: (c: Context, text: string) => Promise<void>,
): void {
  const list = typeof paths === 'string' ? [paths] : paths

  app.on('GET', list, async (c) => c.json({ [key]: await read(c) }))
  app.on('PUT', list, async (c) => {
    await write(c, await readText(c.req.raw, key))
    return c.json({ [key]: await read(c) })
  })
}
