import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.TZ = 'Asia/Tokyo'

const { diaryDateOf, dueSlot, MIN_GAP_MINUTES, newPlan, pickTimes, shiftDate, weekdayOf } =
  await import('./clock')

function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('diaryDateOf', () => {
  it('4 時より前は前の日に入る', () => {
    assert.equal(diaryDateOf(new Date('2026-10-12T01:05:00+09:00')), '2026-10-11')
    assert.equal(diaryDateOf(new Date('2026-10-12T03:59:00+09:00')), '2026-10-11')
    assert.equal(diaryDateOf(new Date('2026-10-12T04:00:00+09:00')), '2026-10-12')
  })
})

describe('shiftDate / weekdayOf', () => {
  it('月をまたいで戻れる', () => {
    assert.equal(shiftDate('2026-11-01', -1), '2026-10-31')
    assert.equal(shiftDate('2026-10-11', -7), '2026-10-04')
  })

  it('2026-10-11 は日曜', () => {
    assert.equal(weekdayOf('2026-10-11'), 0)
  })
})

describe('pickTimes', () => {
  it('時間帯の中に、互いに 2 時間以上離して並べる', () => {
    for (let trial = 0; trial < 200; trial++) {
      const times = pickTimes('2026-10-11', { from: 9, to: 21, count: 3 })
      assert.equal(times.length, 3)
      for (const at of times) {
        assert.ok(at >= new Date('2026-10-11T09:00:00+09:00'))
        assert.ok(at <= new Date('2026-10-11T21:00:00+09:00'))
      }
      for (let i = 1; i < times.length; i++) {
        assert.ok(times[i]!.getTime() - times[i - 1]!.getTime() >= MIN_GAP_MINUTES * 60 * 1000)
      }
    }
  })

  it('幅に入りきらない回数は減らす', () => {
    assert.equal(pickTimes('2026-10-11', { from: 9, to: 12, count: 3 }).length, 2)
  })

  it('乱数が 0 なら始まりから 2 時間おき', () => {
    const times = pickTimes('2026-10-11', { from: 9, to: 21, count: 3 }, () => 0)
    assert.deepEqual(
      times.map((at) => at.toISOString()),
      ['2026-10-11T00:00:00.000Z', '2026-10-11T02:00:00.000Z', '2026-10-11T04:00:00.000Z'],
    )
  })
})

describe('newPlan / dueSlot', () => {
  const settings = { enabled: true, from: 9, to: 21, count: 3 }

  it('昼過ぎに作った予定は、過ぎた時刻を最初から外す', () => {
    const plan = newPlan('2026-10-11', settings, new Date('2026-10-11T12:00:00+09:00'), seq([0]))
    assert.deepEqual(
      plan.slots.map((slot) => slot.state),
      ['skipped', 'skipped', 'pending'],
    )
  })

  it('過ぎてすぐなら聞き、30 分より遅れたものは捨てる', () => {
    const plan = {
      date: '2026-10-11',
      slots: [
        { at: '2026-10-11T01:00:00.000Z', state: 'pending' as const },
        { at: '2026-10-11T04:00:00.000Z', state: 'pending' as const },
        { at: '2026-10-11T08:00:00.000Z', state: 'pending' as const },
      ],
    }
    const { due, late } = dueSlot(plan, new Date('2026-10-11T04:10:00.000Z'))
    assert.equal(due?.at, '2026-10-11T04:00:00.000Z')
    assert.deepEqual(
      late.map((slot) => slot.at),
      ['2026-10-11T01:00:00.000Z'],
    )
  })
})
