import { describe, expect, mock, test } from 'claude-code/testing'

import { subagentFlag } from './classify'


const RESETS = new Date(Date.UTC(2026, 9, 10)).toISOString()
const week = (used: number) => [{ kind: 'seven_day', percentUsed: used, resetsAt: RESETS }]

function harness(on: any, rateLimits: unknown[]) {
  mock.clock(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits } }))
  on('tool.call', () => ({ result: { status: 'completed', content: 'done' } }))
}

const spawn = ($: any, tool = 'Agent') => $.tool.call({ tool, input: { description: 'x', prompt: 'y' } })
const show = async ($: any) =>
  JSON.stringify(await $.command.run({ command: 'adaptive-effort', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }))

describe('subagent flag', () => {
  test('over 50% of the week the flag suggests a lighter alternative; at 50% or with no reading there is none', () => {
    const f = subagentFlag(week(50.1)) ?? ''
    expect(['not preferred', 'not blocked', 'lighter alternative'].every(w => f.includes(w)), 'subagent.test.ts:24').toBe(true)
    expect([subagentFlag(week(50)), subagentFlag(week(10)), subagentFlag([])], 'subagent.test.ts:25').toEqual([undefined, undefined, undefined])
  })

  test('over 50%, a native subagent call runs and carries the flag; it is never denied', async ($, on) => {
    harness(on, week(77))
    const r = await spawn($)
    expect(r.deny, 'subagent.test.ts:31').toBe(undefined)
    expect(r.result, 'subagent.test.ts:32').toEqual({ status: 'completed', content: 'done' })
    expect((r.context ?? []).some((c: string) => c.includes('native subagents are not preferred')), 'subagent.test.ts:33').toBe(true)
    expect((await show($)).includes('Subagents: Weekly usage is 77%'), 'subagent.test.ts:34').toBe(true)
  })

  test('at 50% or under, and for other tools, nothing is added', async ($, on) => {
    harness(on, week(50))
    expect((await spawn($)).context, 'subagent.test.ts:39').toBe(undefined)
    expect((await show($)).includes('Subagents:'), 'subagent.test.ts:40').toBe(false)
  })

  test('other tools carry no flag even over 50%', async ($, on) => {
    harness(on, week(77))
    expect((await spawn($, 'Read')).context, 'subagent.test.ts:45').toBe(undefined)
  })
  test('turned off, a subagent call carries no flag even over 50%', async ($, on) => {
    harness(on, week(77))
    mock.store(on)
    await $.command.run({ command: 'adaptive-effort', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    expect((await spawn($)).context, 'subagent.test.ts:off').toBe(undefined)
  })
})
