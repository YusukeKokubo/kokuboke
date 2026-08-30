import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-mcp-json-'))
process.env.USERS = 'taro'
process.env.CURSOR_CONFIG_DIR = configDir

const { ensureRememberMcp } = await import('./cursor-config')

after(() => fs.rmSync(configDir, { recursive: true, force: true }))

describe('ensureRememberMcp', () => {
  it('既存のサーバーは残して remember を足す', async () => {
    const file = path.join(configDir, 'mcp.json')
    await fsp.writeFile(
      file,
      `${JSON.stringify({ mcpServers: { runpod: { url: 'https://example.invalid/' } } }, null, 2)}\n`,
    )
    await ensureRememberMcp()
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as {
      mcpServers: Record<string, { url?: string; command?: string }>
    }
    assert.equal(parsed.mcpServers.runpod.url, 'https://example.invalid/')
    assert.ok(parsed.mcpServers['kokuboke-remember']?.command)
  })
})
