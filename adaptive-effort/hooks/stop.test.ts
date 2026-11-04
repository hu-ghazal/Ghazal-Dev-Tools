import { describe, expect, test } from 'claude-code/testing'

import { usageLine, weeklyBudget } from './classify'


const H = 3_600_000
const NEVER = 'This line sets only the reasoning effort: it never ends, shortens or pauses the work, and is never a reason to stop a turn; finish the work at the level chosen.'
const week = (used: number, hoursLeft: number) => weeklyBudget([{ kind: 'seven_day', percentUsed: used, resetsAt: new Date(hoursLeft * H).toISOString() }], 0)

describe('the usage line is never a stop', () => {
  test('N1 every pace reading (over, close, room, early, none) ends with the never-a-stop sentence', () => {
    const lines = [week(77, 96), week(40, 96), week(10, 96), week(1, 167), undefined].map(b => usageLine(b, { calls: 1, tokens: [0, 10, 0, 0, 0] }))
    expect(lines.map(l => l.endsWith(NEVER)), 'stop.test.ts:N1').toEqual([true, true, true, true, true])
  })

  test('N2 every drop-back phrase names the effort level, so it cannot read as stopping the work', () => {
    const lines = [week(77, 96), week(40, 96), week(10, 96)].map(b => usageLine(b))
    const drops = lines.flatMap(l => l.match(/drop back[^.;]*/g) ?? [])
    expect([drops.length, drops.every(d => d.startsWith('drop back to a lower effort level'))], 'stop.test.ts:N2').toEqual([3, true])
    expect(lines.some(l => l.includes('lean to the lower of the levels')), 'stop.test.ts:N2-lean').toBe(false)
  })

  test('N3 over budget the lean names the effort level: lean to the lower effort level of those that fit', () => {
    expect(usageLine(week(77, 96)).includes('Spending faster than the week allows: lean to the lower effort level of those that fit,'), 'stop.test.ts:N3').toBe(true)
  })
})
