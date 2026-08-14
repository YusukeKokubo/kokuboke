import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AgentProgressEvent } from '../../shared/types'
import { collectAgent, type ModelChoice } from '../agent'
import { sse } from './sse'

/** 進行の知らせはこちらが送るので、呼ぶ側が送るのは自分の分だけでよい。 */
type Send<E> = (event: E | AgentProgressEvent) => Promise<void>

/**
 * CLI を起動して、届いた本文を SSE に流す。会話と要約で違うのは
 * 「流す前に何を送るか」と「流し終わって何をするか」だけなので、
 * 途中の様子・失敗の知らせ・順番待ちの枠の返却はここが面倒を見る。
 *
 * 枠は成否にかかわらず必ず返す。返し忘れるとその人（そのトピック）が
 * 二度と話せなくなる。
 */
export function streamAgent<E>(
  c: Context,
  run: {
    choice: ModelChoice
    cwd: string
    prompt: string
    systemPrompt: string
    /** limiter.acquire の戻り。 */
    release: () => void
    /** ログに出す札と、理由が分からないときに画面へ出す文言。 */
    tag: string
    fallback: string
    /** 本文より先に送るもの。会話の accepted。 */
    open?: (send: Send<E>) => Promise<void>
    /** 流し終わったあと。集まった本文を受け取る。 */
    close: (text: string, send: Send<E>) => Promise<void>
  },
) {
  return streamSSE(c, async (stream) => {
    const send: Send<E> = sse<E | AgentProgressEvent>(stream)

    try {
      await run.open?.(send)

      const text = await collectAgent(
        run.choice,
        {
          cwd: run.cwd,
          prompt: run.prompt,
          systemPrompt: run.systemPrompt,
          signal: c.req.raw.signal,
        },
        {
          onDelta: async (delta) => {
            await send({ type: 'delta', text: delta })
          },
          onActivity: async (label) => {
            await send({ type: 'activity', label })
          },
        },
      )

      await run.close(text, send)
    } catch (error) {
      console.error(`[${run.tag}]`, error)
      // 相手がもう居ないこともある。知らせられなくても枠は返す。
      await send({
        type: 'error',
        message: error instanceof Error ? error.message : run.fallback,
      }).catch(() => {})
    } finally {
      run.release()
    }
  })
}
