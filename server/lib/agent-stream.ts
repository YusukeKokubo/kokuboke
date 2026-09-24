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
    extraEnv?: Record<string, string>
    extraTools?: string[]
    /** limiter.acquire の戻り。 */
    release: () => void
    /** ログに出す札と、理由が分からないときに画面へ出す文言。 */
    tag: string
    fallback: string
    /** 本文より先に送るもの。会話の accepted。 */
    open?: (send: Send<E>) => Promise<void>
    /** 流し終わったあと。集まった本文を受け取る。 */
    close: (text: string, send: Send<E>) => Promise<void>
    /**
     * 枠を返したあと、接続とは切って走らせる後始末。
     * 命名のように、画面が閉じても止めない仕事向け。
     */
    followUp?: () => void | Promise<void>
    /**
     * 相手が切れても CLI を止めない。会話はアプリを閉じたあとも書き上げ、
     * 終わったら push を飛ばす。下書きのような「画面が居るあいだだけ」の仕事では立てない。
     */
    surviveDisconnect?: boolean
  },
) {
  return streamSSE(c, async (stream) => {
    const send: Send<E> = sse<E | AgentProgressEvent>(stream)
    const survive = run.surviveDisconnect === true

    const emit: Send<E> = async (event) => {
      try {
        await send(event)
      } catch (error) {
        if (!survive) throw error
      }
    }

    try {
      await run.open?.(emit)

      const text = await collectAgent(
        run.choice,
        {
          cwd: run.cwd,
          prompt: run.prompt,
          systemPrompt: run.systemPrompt,
          extraEnv: run.extraEnv,
          extraTools: run.extraTools,
          signal: survive ? undefined : c.req.raw.signal,
        },
        {
          onDelta: async (delta) => {
            await emit({ type: 'delta', text: delta })
          },
          onActivity: async (label) => {
            await emit({ type: 'activity', label })
          },
        },
      )

      await run.close(text, emit)
    } catch (error) {
      console.error(`[${run.tag}]`, error)
      // 相手がもう居ないこともある。知らせられなくても枠は返す。
      await emit({
        type: 'error',
        message: error instanceof Error ? error.message : run.fallback,
      })
    } finally {
      run.release()
    }

    if (run.followUp) {
      void Promise.resolve(run.followUp()).catch((error) => {
        console.error(`[${run.tag}:followUp]`, error)
      })
    }
  })
}
