import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * cursor-agent が実際に吐いた出力を記録しておき、CLI の代わりにそれを流して
 * エンジンを通しで動かす。区切りの言い直しの見分けは、向こうが約束している形では
 * なく「それまで流した分と丸ごと同じ」という当て推量に寄りかかっているので、
 * 部品の単体テストだけでは崩れたことに気付けない。
 *
 * 記録の取り直しは `--print --output-format stream-json --stream-partial-output`
 * の出力をそのまま保存するだけ。中の絶対パスだけ均してある。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, '__fixtures__', 'cursor')

// config は読み込んだ時点で環境変数を見るので、import より先に差し込む。
process.env.USERS = 'taro'
process.env.CURSOR_BIN = path.join(fixtures, 'replay.sh')

// 起動のたびに設定を確かめに行くので、手元の ~/.cursor から引き離しておく。
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-cursor-'))
fs.writeFileSync(
  path.join(configDir, 'cli-config.json'),
  JSON.stringify({ autoAcceptWebSearch: true }),
)
process.env.CURSOR_CONFIG_DIR = configDir

const { cursorAgent } = await import('./cursor')

after(() => fs.rmSync(configDir, { recursive: true, force: true }))

interface Replayed {
  /** 画面に流れた分（差分の積み上げ）。 */
  streamed: string
  /** ログに残る分。 */
  saved: string
  labels: string[]
}

async function replay(name: string): Promise<Replayed> {
  process.env.CURSOR_FIXTURE = path.join(fixtures, name)

  const result: Replayed = { streamed: '', saved: '', labels: [] }
  for await (const event of cursorAgent.run({
    cwd: here,
    prompt: '',
    systemPrompt: '',
    model: 'auto',
  })) {
    if (event.type === 'delta') result.streamed += event.text
    else if (event.type === 'activity') result.labels.push(event.label)
    else result.saved = event.text
  }
  return result
}

/** 記録の名前と、そこに入っている形。 */
const CASES = [
  { file: 'one-segment.jsonl', note: '区切りが一つ、道具も一つ' },
  { file: 'preamble-model-call-id.jsonl', note: '前置きあり。言い直しに model_call_id が付いた回' },
  { file: 'preamble-repeat.jsonl', note: '前置きあり。言い直しが差分と同じ形で来た回' },
  { file: 'many-tools.jsonl', note: '前置きなし。道具を何度も使う回' },
]

describe('cursor の記録を通しで流す', () => {
  for (const { file, note } of CASES) {
    it(`${note}（${file}）`, async () => {
      const { streamed, saved, labels } = await replay(file)

      assert.ok(streamed.length > 0, '本文が一つも流れていない')
      // ここがずれると、画面で読んだものと後から読み返すものが食い違う。
      assert.equal(streamed, saved)
      // 道具を使っている記録ばかりなので、札は必ず出る。
      assert.ok(labels.length > 0, '札が一つも出ていない')
      for (const label of labels) assert.match(label, /ています$/)
    })
  }

  it('前置きは一度しか出ない（言い直しを差分として流さない）', async () => {
    const { streamed } = await replay('preamble-repeat.jsonl')
    const preamble = '「三河弁」の由来を調べます。\n'

    assert.ok(streamed.startsWith(preamble))
    assert.equal(streamed.split(preamble).length - 1, 1, '前置きが二重になっている')
  })

  it('道具を挟んでも前置きがログから落ちない', async () => {
    // result が持っているのは最後の区切りだけなので、そちらを採ると前置きが消える。
    const { saved } = await replay('preamble-model-call-id.jsonl')

    assert.equal(
      saved,
      'まず一言お詫びしてから、`memo.txt` を確認します。\n' +
        'ごめんなさい。\n\n`memo.txt` を確認しました。ひみつの数字は **42** です。',
    )
  })

  it('読み書きと検索で札が変わる', async () => {
    const read = await replay('one-segment.jsonl')
    assert.deepEqual([...new Set(read.labels)], ['ファイルを見ています'])

    const web = await replay('preamble-repeat.jsonl')
    assert.ok(web.labels.includes('ウェブで調べています'))
  })
})
