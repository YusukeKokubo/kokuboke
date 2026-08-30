#!/usr/bin/env node
/**
 * 捨て MCP。起動時点の cwd / env をファイルへ吐く。
 * stdin は Content-Length と行区切りの両方を受け、同じ形で返す。
 */
import fs from 'node:fs'
import path from 'node:path'

const dumpPath = process.env.MCP_DUMP_PATH || path.join(import.meta.dirname, 'dump.json')
const dumps = []

function snapshot() {
  const keys = Object.keys(process.env)
    .filter((k) => k.startsWith('KOKUBOKE_') || k.startsWith('MCP_') || k === 'HOME' || k === 'PWD')
    .sort()
  const env = {}
  for (const k of keys) env[k] = process.env[k]
  return {
    cwd: process.cwd(),
    argv: process.argv,
    env,
    pid: process.pid,
    ppid: process.ppid,
  }
}

function writeDump(extra) {
  dumps.push({ at: new Date().toISOString(), ...snapshot(), ...extra })
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true })
  fs.writeFileSync(dumpPath, `${JSON.stringify(dumps, null, 2)}\n`)
}

writeDump({ phase: 'boot' })

let framing = null

function send(obj) {
  const json = JSON.stringify(obj)
  if (framing === 'headers') {
    const body = Buffer.from(json, 'utf8')
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
    process.stdout.write(body)
    return
  }
  process.stdout.write(`${json}\n`)
}

function handle(msg) {
  writeDump({ phase: 'message', method: msg.method, id: msg.id, framing })
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'kokuboke-dump', version: '0.0.1' },
      },
    })
    return
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') return
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'dump',
            description: 'Probe helper. Call once and return.',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    })
    return
  }
  if (msg.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { content: [{ type: 'text', text: JSON.stringify(snapshot()) }] },
    })
    return
  }
  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown' } })
  }
}

let buf = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  if (!framing) {
    framing = buf.includes('\r\n\r\n') || buf.includes('Content-Length') ? 'headers' : 'lines'
    writeDump({ phase: 'framing', detected: framing, preview: buf.toString('utf8').slice(0, 400) })
  }
  if (framing === 'headers') {
    while (true) {
      const text = buf.toString('utf8')
      const split = text.indexOf('\r\n\r\n')
      if (split < 0) return
      const header = text.slice(0, split)
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) return
      const len = Number(match[1])
      const start = split + 4
      const bytes = buf.subarray(start)
      if (bytes.length < len) return
      const body = bytes.subarray(0, len).toString('utf8')
      buf = bytes.subarray(len)
      try {
        handle(JSON.parse(body))
      } catch (error) {
        writeDump({ phase: 'parse-error', body, error: String(error) })
      }
    }
  } else {
    while (true) {
      const nl = buf.indexOf(10)
      if (nl < 0) return
      const line = buf.subarray(0, nl).toString('utf8').trim()
      buf = buf.subarray(nl + 1)
      if (!line) continue
      try {
        handle(JSON.parse(line))
      } catch (error) {
        writeDump({ phase: 'parse-error', line, error: String(error) })
      }
    }
  }
})
