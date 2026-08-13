import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// config は読み込んだ時点で環境変数を見るので、import より先に差し込む。
process.env.USERS = 'taro'

const { assistantSegment } = await import('./cursor')

/** 2026.08.11-e8db854 で実際に届いた行の形。 */
function line(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    session_id: 'x',
    ...extra,
  }
}

describe('assistantSegment', () => {
  it('timestamp_ms だけが付いた行は差分', () => {
    assert.deepEqual(assistantSegment(line('ま', { timestamp_ms: 1 }), ''), {
      kind: 'delta',
      text: 'ま',
    })
  })

  it('最後の区切りには timestamp_ms が付かない', () => {
    assert.deepEqual(assistantSegment(line('まとめ'), 'まとめ'), {
      kind: 'complete',
      text: 'まとめ',
    })
  })

  it('model_call_id が付いていれば区切りの終わり', () => {
    assert.deepEqual(assistantSegment(line('前置き', { timestamp_ms: 1, model_call_id: 'c1' }), ''), {
      kind: 'complete',
      text: '前置き',
    })
  })

  it('そこまで流した分と丸ごと同じなら言い直しの疑い', () => {
    // 途中の区切りの言い直しは、キーの上では差分と見分けが付かない。
    // ここを差分として扱うと、道具を挟んだ回だけ前半が二重になる。
    const got = assistantSegment(line('調べるね。\n', { timestamp_ms: 1 }), '調べるね。\n')
    assert.deepEqual(got, { kind: 'repeat', text: '調べるね。\n' })
  })

  it('途中まで同じでも、丸ごと同じでなければ差分', () => {
    assert.deepEqual(assistantSegment(line('調べる', { timestamp_ms: 1 }), '調べるね。\n'), {
      kind: 'delta',
      text: '調べる',
    })
  })

  it('区切りの頭では言い直しと取り違えない', () => {
    // pending が空のときに空文字と一致させてしまうと、全部が言い直しになる。
    assert.deepEqual(assistantSegment(line('', { timestamp_ms: 1 }), ''), {
      kind: 'delta',
      text: '',
    })
  })

  it('本文以外の block は混ぜない', () => {
    const got = assistantSegment(
      {
        type: 'assistant',
        timestamp_ms: 1,
        message: {
          content: [
            { type: 'thinking', text: '考え中' },
            { type: 'text', text: '答え' },
          ],
        },
      },
      '',
    )
    assert.deepEqual(got, { kind: 'delta', text: '答え' })
  })

  it('本文が無い形でも落ちない', () => {
    assert.deepEqual(assistantSegment({ type: 'assistant', timestamp_ms: 1 }, ''), {
      kind: 'delta',
      text: '',
    })
  })
})
