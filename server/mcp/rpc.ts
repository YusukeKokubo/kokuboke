import { remember } from './remember'

export type JsonRpc = {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: Record<string, unknown>
}

const TOOL = {
  name: 'remember',
  description:
    '家族の事実や好みを覚える。次の会話から参照される。パスや宛先は指定できない。',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '覚える内容' },
    },
    required: ['text'],
  },
}

function toolText(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError }
}

export async function handleMessage(
  msg: JsonRpc,
  cwd = process.cwd(),
): Promise<Record<string, unknown> | null> {
  if (msg.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'kokuboke-remember', version: '0.1.0' },
      },
    }
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
    return null
  }
  if (msg.method === 'tools/list') {
    return { jsonrpc: '2.0', id: msg.id, result: { tools: [TOOL] } }
  }
  if (msg.method === 'tools/call') {
    const name = typeof msg.params?.name === 'string' ? msg.params.name : ''
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
    if (name !== 'remember') {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `unknown tool: ${name}` },
      }
    }
    const text = typeof args.text === 'string' ? args.text : ''
    const result = await remember(text, cwd)
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: result.ok ? toolText('覚えた') : toolText(result.reason, true),
    }
  }
  if (msg.id !== undefined) {
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown method' } }
  }
  return null
}
