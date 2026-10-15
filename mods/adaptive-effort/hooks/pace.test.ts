import { describe, expect, mock, test } from 'claude-code/testing'

import { STANDARD, rulesLine, trackPace, weeklyBudget } from './classify'


const OPUS = 'claude-opus-5-5'
const SIMPLE = 'rename the variable foo to bar in utils.ts'
const H = 3600_000
// The mocked clock starts at 0: a reset 96 h ahead leaves 4 days, 72 h of the week gone.
const RESETS = new Date(96 * H).toISOString()
const week = (used: number) => [{ kind: 'seven_day', percentUsed: used, resetsAt: RESETS }]

const answer = ($: any, effort: string) => $.tool.call({ tool: 'Bash', command: `echo "EFFORT=${effort}"` })
function harness(on: any, rateLimits: unknown[] | undefined) {
  const efforts: (string | undefined)[] = []
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
  if (rateLimits) on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits } }))
  on('turn.step', async function* ($: any, e: any) {
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return efforts
}

async function step($: any, index: number) {
  const s = $.turn.step({ turnId: 't1', index, model: OPUS, effort: 'medium', messageCount: 1 })
  for await (const _ of s) void _
}

const show = async ($: any) =>
  JSON.stringify(await $.command.run({ command: 'adaptive-effort', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }))

describe('weekly budget', () => {
  test('the budget is what is left over the hours left, against the spend', () => {
    // 77% used, 23% left over 96 h: 0.2396%/h allowed; the week so far spent 77% in 72 h, 1.069%/h.
    const b = weeklyBudget(week(77), 0)
    expect([b?.basis, Math.round((b?.allowed ?? 0) * 1e4), Math.round((b?.burn ?? 0) * 1e4), Math.round((b?.h ?? 0) * 1000)], 'pace.test.ts:39').toEqual(['week', 2396, 10694, 224])
    // Once the readings span 30 min, the recent spend decides: 1% in the last hour.
    const recent = weeklyBudget(week(77), H, [{ at: 0, used: 76 }])
    expect([recent?.basis, Math.round((recent?.burn ?? 0) * 1000)], 'pace.test.ts:42').toEqual(['recent', 1000])
    expect(weeklyBudget(week(77), 10 * 60_000, [{ at: 0, used: 76.9 }])?.basis, 'pace.test.ts:43').toBe('week')
    expect(weeklyBudget([{ kind: 'five_hour', percentUsed: 90, resetsAt: RESETS }], 0), 'pace.test.ts:44').toBe(undefined)
  })

  test('readings are kept every 5 minutes inside the 2-hour window, and a new week starts over', () => {
    let log = trackPace({ samples: [] }, week(70), 0)
    log = trackPace(log, week(70.1), 60_000)
    log = trackPace(log, week(70.5), 5 * 60_000)
    expect(log.samples, 'pace.test.ts:51').toEqual([{ at: 0, used: 70 }, { at: 300_000, used: 70.5 }])
    log = trackPace(log, [{ kind: 'seven_day', percentUsed: 1, resetsAt: new Date(96 * H + 7 * 24 * H).toISOString() }], 6 * 60_000)
    expect(log.samples, 'pace.test.ts:53').toEqual([{ at: 360_000, used: 1 }])
  })

  test('over budget every count is one higher in the line beside the prompt, and it names lighter helpers', () => {
    const w = rulesLine(STANDARD, weeklyBudget(week(77), 0))
    const want = [
      'weekly usage over budget at 77%, every count one higher',
      'max: a design or architecture decision with real trade-offs; a failure still unexplained after 3 attempts; a change across 3 or more systems',
      'xhigh: the same kind of failure a 4th time',
      'high: 4 or more files or components that must stay consistent; a procedure of 6 or more steps with checks',
      'prefer lighter helpers',
    ]
    expect(want.filter(x => !w.includes(x)), 'pace.test.ts:weight').toEqual([])
    const within = rulesLine(STANDARD, weeklyBudget(week(10), 0))
    expect([within.includes('over budget'), within.includes('a failure still unexplained after 2 attempts'), within.includes('echo "EFFORT=')], 'pace.test.ts:no-weight').toEqual([false, true, true])
  })

  test('over budget, the prompt carries the thresholds line and an answered max stays max (no cap)', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on, week(77))
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    const sent: any = await $.prompt.submit({ text: SIMPLE } as any)
    expect((sent?.context ?? []).filter((c: string) => c.startsWith('adaptive-effort: decide your reasoning effort')).length, 'pace.test.ts:line-beside-prompt').toBe(1)
    expect((await answer($, 'max')).context, 'pace.test.ts:answer-carries-nothing').toBe(undefined)
    await step($, 0)
    await clock.advance(121_000)
    await step($, 1)
    expect(efforts, 'pace.test.ts:77').toEqual(['max', 'max'])
    const text = await show($)
    expect(text.includes('77% used, 23% left over'), 'pace.test.ts:79').toBe(true)
    expect(text.includes('the effort sent is never lowered'), 'pace.test.ts:80').toBe(true)
  })

  test('within budget at the standard thresholds, the rules line has no budget step, and max stays', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on, week(40))
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    const sent: any = await $.prompt.submit({ text: SIMPLE } as any)
    expect((sent?.context ?? []).map((c: string) => c.includes('over budget')), 'pace.test.ts:no-line').toEqual([false])
    await answer($, 'max')
    await step($, 0)
    await clock.advance(121_000)
    await step($, 1)
    expect(efforts, 'pace.test.ts:90').toEqual(['max', 'max'])
  })

  test('with no 7-day reading there is no cap, and /adaptive-effort says so', async ($, on) => {
    mock.clock(on)
    const efforts = harness(on, [])
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    await answer($, 'max')
    await step($, 0)
    expect(efforts, 'pace.test.ts:98').toEqual(['max'])
    expect((await show($)).includes('no 7-day reading yet, no cap'), 'pace.test.ts:99').toBe(true)
  })
})
