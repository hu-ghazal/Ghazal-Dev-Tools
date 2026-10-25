import { describe, expect, mock, test } from 'claude-code/testing'

import { EMPTY_CHART, lastHourUse, recordStep } from './chart'
import { STANDARD, rulesLine, trackPace, usageLine, weeklyBudget } from './classify'


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
  test('beside every prompt Claude sees the usage, the one cost rule of its pace, and the project signals', () => {
    const room = rulesLine(STANDARD, weeklyBudget(week(10), 0)) // 90% over 96 h: 22.5% a day allowed, 3.3% a day spent
    const near = rulesLine(STANDARD, weeklyBudget(week(40), 0)) // 60% over 96 h: 15% a day allowed, 13.3% a day spent
    const over = rulesLine(STANDARD, weeklyBudget(week(77), 0)) // 23% over 96 h: 5.8% a day allowed, 25.7% a day spent
    const none = rulesLine(STANDARD, undefined)
    const want: [string, string, string][] = [
      [room, 'Usage: this week 10% used, 90% left for 96 h: 22.5% a day allowed, spending 3.3% a day (the week so far)', 'room-figures'],
      [room, 'Room in the week:', 'room-rule'],
      [near, 'this week 40% used, 60% left for 96 h: 15% a day allowed, spending 13.3% a day', 'near-figures'],
      [near, "Close to the week's pace:", 'near-rule'],
      [over, 'Spending faster than the week allows:', 'over-rule'],
      [none, 'Usage: no weekly reading yet.', 'none'],
    ]
    expect(want.filter(([l, x]) => !l.includes(x)).map(w => w[2]), 'pace.test.ts:usage-figures').toEqual([])
    // Where several levels fit, the choice is Claude's, by the work and the usage.
    for (const l of [room, near, over, none]) {
      expect(l.includes('When the conditions of more than one level fit, the choice among them is yours, by the work in front of you and this usage.'), 'pace.test.ts:free-choice').toBe(true)
    }
    // Only the rule of the pace in force: no rule for another pace to weigh.
    const rules = ['Room in the week:', "Close to the week's pace:", 'Spending faster than the week allows:']
    expect([room, near, over, none].map(l => rules.filter(r => l.includes(r)).length), 'pace.test.ts:one-rule').toEqual([1, 1, 1, 0])
    for (const l of [room, near, over, none]) {
      expect(l.includes('Usage never raises a level the conditions do not support.'), 'pace.test.ts:never-raises').toBe(true)
      expect(l.includes('answer one level higher, never max on these alone'), 'pace.test.ts:project-signals').toBe(true)
    }
  })

  test("the session's output of the last hour goes into the line, by level", () => {
    let log = recordStep(EMPTY_CHART, 'medium', 0, 99_000) // more than an hour before: not counted
    log = recordStep(log, 'high', 90 * 60_000, 10_000)
    log = recordStep(log, 'high', 100 * 60_000, 2_000)
    log = recordStep(log, 'medium', 140 * 60_000, 1_900)
    const use = lastHourUse(log, 141 * 60_000)
    expect(use, 'pace.test.ts:last-hour').toEqual({ calls: 3, tokens: [0, 1_900, 12_000, 0, 0] })
    expect(rulesLine(STANDARD, undefined, use).includes('This session, last hour: 3 calls, 14k output tokens (medium 1.9k, high 12k).'), 'pace.test.ts:session-line').toBe(true)
    expect(usageLine(undefined, lastHourUse(EMPTY_CHART, 0)).includes('This session, last hour: no calls yet.'), 'pace.test.ts:session-none').toBe(true)
  })

  test('the budget is what is left over the hours left, against the spend', () => {
    // 77% used, 23% left over 96 h: 0.2396%/h allowed; the week so far spent 77% in 72 h, 1.069%/h.
    const b = weeklyBudget(week(77), 0)
    expect([b?.basis, Math.round((b?.allowed ?? 0) * 1e4), Math.round((b?.burn ?? 0) * 1e4), Math.round((b?.h ?? 0) * 1000)], 'pace.test.ts:39').toEqual(['week', 2396, 10694, 224])
    // Two rises an hour apart: the recent spend decides, 1% in that hour.
    const recent = weeklyBudget(week(77), 70 * 60_000, [{ at: 0, used: 75 }, { at: 10 * 60_000, used: 76 }])
    expect([recent?.basis, Math.round((recent?.burn ?? 0) * 1000)], 'pace.test.ts:42').toEqual(['recent', 1000])
    expect(weeklyBudget(week(77), 10 * 60_000, [{ at: 0, used: 76.9 }])?.basis, 'pace.test.ts:43').toBe('week')
    expect(weeklyBudget([{ kind: 'five_hour', percentUsed: 90, resetsAt: RESETS }], 0), 'pace.test.ts:44').toBe(undefined)
  })

  test('the whole-percent reading: unchanged or one rise is no rate; two rises too close or out of the window are none either', () => {
    const flat = weeklyBudget(week(77), 40 * 60_000, [{ at: 0, used: 77 }])
    const one = weeklyBudget(week(77), 40 * 60_000, [{ at: 0, used: 76 }, { at: 5 * 60_000, used: 77 }])
    const close = weeklyBudget(week(77), 30 * 60_000, [{ at: 0, used: 75 }, { at: 5 * 60_000, used: 76 }, { at: 20 * 60_000, used: 77 }])
    const old = weeklyBudget(week(77), 8 * H, [{ at: 0, used: 75 }, { at: H, used: 76 }, { at: 2 * H, used: 77 }])
    expect([flat, one, close, old].map(b => b?.basis), 'pace.test.ts:no-rate').toEqual(['week', 'week', 'week', 'week'])
    const kept = weeklyBudget(week(77), 5 * H, [{ at: 0, used: 75 }, { at: H, used: 76 }, { at: 3 * H, used: 77 }])
    expect([kept?.basis, Math.round((kept?.burn ?? 0) * 1000)], 'pace.test.ts:rate').toEqual(['recent', 500])
  })

  test('readings are kept every 5 minutes inside the 2-hour window, and a new week starts over', () => {
    let log = trackPace({ samples: [] }, week(70), 0)
    log = trackPace(log, week(70.1), 60_000)
    log = trackPace(log, week(70.5), 5 * 60_000)
    expect(log.samples, 'pace.test.ts:51').toEqual([{ at: 0, used: 70 }, { at: 300_000, used: 70.5 }])
    log = trackPace(log, [{ kind: 'seven_day', percentUsed: 1, resetsAt: new Date(96 * H + 7 * 24 * H).toISOString() }], 6 * 60_000)
    expect(log.samples, 'pace.test.ts:53').toEqual([{ at: 360_000, used: 1 }])
  })

  test('over budget every count is one higher in the line beside the prompt, and it names no helpers', () => {
    const w = rulesLine(STANDARD, weeklyBudget(week(77), 0))
    const want = [
      'weekly usage over budget at 77%, every count one higher',
      'a bug whose cause is still unknown after 3 attempts (general: a problem whose cause is still unknown after 3 attempts)',
      'xhigh: the same test or check fails a 4th time (general: the same problem comes back a 4th time)',
      'high: 4 or more files that must stay consistent (general: 4 or more pieces that must agree with each other); 6 or more steps',
    ]
    expect(want.filter(x => !w.includes(x)), 'pace.test.ts:weight').toEqual([])
    expect(w.includes('helpers'), 'pace.test.ts:one-helper-rule').toBe(false)
    const within = rulesLine(STANDARD, weeklyBudget(week(10), 0))
    expect([within.includes('over budget'), within.includes('a bug whose cause is still unknown after 2 attempts'), within.includes('echo "EFFORT=')], 'pace.test.ts:no-weight').toEqual([false, true, true])
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
    expect(text.includes('an answer Claude gave is never cut down'), 'pace.test.ts:80').toBe(true)
  })

  test('within budget at the standard thresholds, the rules line has no budget step, and max stays', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on, week(40))
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    const sent: any = await $.prompt.submit({ text: SIMPLE } as any)
    expect((sent?.context ?? []).map((c: string) => c.includes('over budget')), 'pace.test.ts:no-line').toEqual([false])
    expect((sent?.context ?? []).map((c: string) => c.includes('Usage: this week 40% used') && c.includes('This session, last hour: no calls yet.')), 'pace.test.ts:usage-beside-prompt').toEqual([true])
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
