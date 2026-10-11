import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-diary-'))
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-diary-bin-'))
const promptLog = path.join(binDir, 'prompts.log')

process.env.TZ = 'Asia/Tokyo'
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
process.env.DEFAULT_ENGINE = 'claude'
process.env.FCM_SERVICE_ACCOUNT = ''
process.env.FCM_SERVICE_ACCOUNT_PATH = ''

/**
 * Claude Code の代わり。プロンプトの中身で何を頼まれたかを見分けて、決まった返事を
 * result の一行で返す。頼まれたプロンプトは横に書き残して、あとで中身を確かめる。
 */
function result(text: string): string {
  return JSON.stringify({ type: 'result', result: text })
}
const proposal = JSON.stringify({
  changes: [
    { type: 'add', text: '- 週末は子どもとホームセンターへ行く', dates: ['2026-10-08', '2026-10-10'] },
    { type: 'add', text: '- 一日だけの話', dates: ['2026-10-10'] },
    { type: 'remove', text: '- 朝はコーヒー', reason: '紅茶に変えたと話していた' },
  ],
})
const fake = path.join(binDir, 'claude')
fs.writeFileSync(
  fake,
  `#!/bin/sh
input=$(cat)
printf '%s\\n=====\\n' "$input" >> '${promptLog}'
case "$input" in
  *"直し案を出してください"*) printf '%s\\n' '${result(proposal)}' ;;
  *"この日の記録を書いてください"*) printf '%s\\n' '${result('洗濯を干してから、子どもとホームセンターへ。')}' ;;
  *) printf '%s\\n' '${result('日本シリーズが延長戦だったらしいね。今何してる？')}' ;;
esac
`,
  { mode: 0o755 },
)
process.env.CLAUDE_BIN = fake

const { addDevice } = await import('../store/device')
const { assertUser } = await import('../store/paths')
const { ensureUser, readProfile, writeProfile } = await import('../store/user')
const { appendMessage, readAll } = await import('../store/log')
const { listDiaryTopics, readMeta } = await import('../store/topic')
const diaryStore = await import('../store/diary')
const { replan, tickUser } = await import('./scheduler')
const { applyProposal, askQuestion } = await import('./jobs')

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(binDir, { recursive: true, force: true })
})

const TARO = assertUser('taro')

function jst(value: string): Date {
  return new Date(`${value}+09:00`)
}

describe('いまなにしとる の一日', () => {
  it('聞いて、答えをためて、翌朝に日記と直し案を書く', async () => {
    await ensureUser(TARO)
    await writeProfile(TARO, '# taro\n\n- 会社員\n- 朝はコーヒー\n')
    await addDevice(TARO, `t${'x'.repeat(140)}`)
    await diaryStore.writeDiarySettings(TARO, { enabled: true, from: 9, to: 21, count: 2 })
    await diaryStore.writePlan(TARO, {
      date: '2026-10-10',
      slots: [
        { at: jst('2026-10-10T10:00:00').toISOString(), state: 'pending' },
        { at: jst('2026-10-10T14:00:00').toISOString(), state: 'pending' },
      ],
    })
    // 二日分ないと直し案は作らないので、前の日の日記を先に置いておく。
    await diaryStore.writeEntry(TARO, {
      date: '2026-10-08',
      topic: 'old',
      answers: [{ at: '12:00', text: '子どもとホームセンター' }],
      record: '昼にホームセンター。',
      edited: false,
    })

    // 10:05 に見回ると、10:00 の分を聞く。
    await tickUser(TARO, jst('2026-10-10T10:05:00'))
    const topics = await listDiaryTopics(TARO)
    assert.equal(topics.length, 1)
    assert.equal(topics[0]!.date, '2026-10-10')
    const meta = await readMeta(TARO, topics[0]!.folder)
    assert.equal(meta.name, '10月10日のいまなにしとる')
    assert.deepEqual(meta.tags, ['日記'])
    const first = await readAll(TARO, topics[0]!.folder)
    assert.equal(first.length, 1)
    assert.equal(first[0]!.role, 'assistant')
    assert.match(first[0]!.text, /今何してる/)

    const plan = await diaryStore.readPlan(TARO)
    assert.equal(plan?.topic, topics[0]!.slug)
    assert.deepEqual(
      plan?.slots.map((slot) => slot.state),
      ['asked', 'pending'],
    )

    await appendMessage(TARO, topics[0]!.folder, {
      id: 'a1',
      role: 'user',
      text: '洗濯干し終わって、子どもとホームセンター行くとこ',
      images: [],
      at: jst('2026-10-10T10:20:00').toISOString(),
    })

    // 14:00 の分は 50 分遅れなので聞かずに捨てる。
    await tickUser(TARO, jst('2026-10-10T14:50:00'))
    assert.equal((await readAll(TARO, topics[0]!.folder)).length, 2)
    assert.deepEqual(
      (await diaryStore.readPlan(TARO))?.slots.map((slot) => slot.state),
      ['asked', 'skipped'],
    )

    // 日曜の 4 時を過ぎたら、前の日の日記と直し案。
    await tickUser(TARO, jst('2026-10-11T04:01:00'))
    const entry = await diaryStore.readEntry(TARO, '2026-10-10')
    assert.ok(entry)
    assert.deepEqual(entry.answers, [{ at: '10:20', text: '洗濯干し終わって、子どもとホームセンター行くとこ' }])
    assert.match(entry.record, /ホームセンター/)
    assert.equal(entry.topic, topics[0]!.slug)

    const proposed = await diaryStore.readProposal(TARO)
    assert.deepEqual(
      proposed?.changes.map((change) => change.type),
      ['add', 'remove'],
    )

    const nextPlan = await diaryStore.readPlan(TARO)
    assert.equal(nextPlan?.date, '2026-10-11')

    // 足す方だけ選ぶ。消す方は見送りとして残る。
    const profile = await applyProposal(TARO, [proposed!.changes[0]!.id])
    assert.equal(profile, '# taro\n\n- 会社員\n- 朝はコーヒー\n- 週末は子どもとホームセンターへ行く\n')
    assert.equal(await readProfile(TARO), profile)
    assert.equal(await diaryStore.readProposal(TARO), null)
    const revisions = await diaryStore.readProfileRevisions(TARO)
    assert.deepEqual(revisions.at(-1)?.rejected, ['消す「- 朝はコーヒー」'])

    // 直し案のプロンプトに渡したのは、二日分の答えだけ。
    const prompts = fs.readFileSync(promptLog, 'utf8')
    assert.match(prompts, /<day date="2026-10-08">/)
    assert.match(prompts, /<day date="2026-10-10">/)
  })

  it('聞かない設定なら、日付が変わっても予定を作らない', async () => {
    await diaryStore.writeDiarySettings(TARO, { enabled: false, from: 9, to: 21, count: 3 })
    await tickUser(TARO, jst('2026-10-12T04:01:00'))
    assert.equal(await diaryStore.readPlan(TARO), null)
  })

  it('人が直した記録は、見回りの書き直しで上書きしない', async () => {
    const { writeDiary, saveRecord } = await import('./jobs')
    await saveRecord(TARO, '2026-10-10', '手で直した記録')
    const kept = await writeDiary(TARO, '2026-10-10')
    assert.equal(kept?.record, '手で直した記録')
    assert.equal(kept?.edited, true)

    const forced = await writeDiary(TARO, '2026-10-10', { force: true })
    assert.match(forced?.record ?? '', /ホームセンター/)
    assert.equal(forced?.edited, false)
  })

  it('手で聞いた分は予定に残り、設定を変えてもその 2 時間以内は選ばない', async () => {
    const now = jst('2026-10-13T10:49:00')
    await diaryStore.writeDiarySettings(TARO, { enabled: true, from: 9, to: 21, count: 6 })
    await askQuestion(TARO, now, { manual: true })
    const asked = await diaryStore.readPlan(TARO)
    assert.equal(asked?.date, '2026-10-13')
    assert.deepEqual(
      asked?.slots.map((slot) => [slot.at, slot.state]),
      [[now.toISOString(), 'asked']],
    )

    for (let trial = 0; trial < 20; trial++) {
      await replan(TARO, now)
      const plan = await diaryStore.readPlan(TARO)
      for (const slot of plan!.slots.filter((item) => item.state === 'pending')) {
        const at = new Date(slot.at).getTime()
        assert.ok(at > now.getTime(), '過ぎた時刻は選ばない')
        assert.ok(Math.abs(at - now.getTime()) >= 2 * 60 * 60 * 1000, '手で聞いた 2 時間以内は選ばない')
      }
    }
  })
})
