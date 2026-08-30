#!/usr/bin/env node
/**
 * stdio の行区切り JSON-RPC。cursor がこの形で話しかけてくる
 * （2026.08.30、macOS と Linux で確認）。
 */
import readline from 'node:readline'
import { handleMessage } from './rpc'

function send(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg: { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(trimmed) as typeof msg
  } catch {
    return
  }
  void handleMessage(msg).then((reply) => {
    if (reply) send(reply)
  })
})
