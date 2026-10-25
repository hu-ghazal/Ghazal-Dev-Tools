import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_DEFINITIONS, DEFINED, dwell, overBudget, usageLine, validDefinitions, weeklyBudget } from './classify'
import { EMPTY_CHART, ORDER, chartView, lastHourUse, levelRows, recordStep, restored } from './chart'


const OPUS = 'claude-opus-5-5'
const MIN = 60_000
const H = 3_600_000
const ANSWER = (effort: string) => `echo "EFFORT=${effort}"`
const PANE = { requestId: 'adaptive-effort', component: 'Pane', props: {} }

function harness(on: any): (string | undefined)[] {
  const efforts: (string | undefined)[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'adaptive-effort' } }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits: [] } }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('turn.step', async function* ($: any, e: any) {
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { output_tokens: 10 } }
  })
  return efforts
}

async function step($: any, index: number) {
  const s = $.turn.step({ turnId: 't1', index, model: OPUS, effort: 'medium', messageCount: 1 })
  for await (const _ of s) void _
}
const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
const prompt = ($: any) => $.turn.start({ turnId: 't1', text: 'next request' })
const answer = ($: any, effort: string) => $.tool.call({ tool: 'Bash', command: ANSWER(effort) })

describe('low in the pane, the chart and the pace', () => {
  test('P1 the pane shows a Low card under Medium, and the Effort now pill reads Low after a low answer', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    expect(
      [(await ui.find({ type: 'Text', text: ' Low ' })) !== undefined, (await ui.find({ type: 'Text', text: 'Questions, conversation, information' })) !== undefined],
      'low.test.ts:P1',
    ).toEqual([true, true])
  })

  test('S1 Settings has a Low definition card, and saved definitions from before low still load with the default low', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    harness(on)
    await start($)
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    await ui.press({ key: 'settings' })
    expect((await ui.find({ key: 'defs-low' })) !== undefined, 'low.test.ts:S1-card').toBe(true)
    const old: any = Object.fromEntries(DEFINED.filter(l => l !== 'low').map(l => [l, DEFAULT_DEFINITIONS[l]]))
    expect([DEFINED.at(-1), validDefinitions(old)?.low], 'low.test.ts:S1-old').toEqual(['low', DEFAULT_DEFINITIONS.low])
  })

  test('L3 low lasts only for its turn: the next prompt sends medium until Claude answers again', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    await clock.advance(2 * MIN)
    await prompt($)
    await step($, 0)
    expect(efforts, 'low.test.ts:L3').toEqual(['low', 'medium'])
  })

  test('L4 a rise from low applies at once, without the 60 s hold', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    await clock.advance(5_000)
    await answer($, 'high')
    await step($, 1)
    expect([efforts, dwell('low', 'high', 0, 1).effort, dwell('medium', 'high', 0, 1).effort], 'low.test.ts:L4').toEqual([['low', 'high'], 'high', 'medium'])
  })

  test('C2 the chart gives low its own column, and a saved four-column chart reads back with a zero low column', () => {
    const log = recordStep(recordStep(EMPTY_CHART, 'low', 1_000, 40), 'medium', 2_000, 60)
    const v = chartView(log, 3_000)
    expect([ORDER[0], v.tokens, levelRows(v).map(r => r.level), lastHourUse(log, 3_000).tokens], 'low.test.ts:C2-column').toEqual([
      'low', [40, 60, 0, 0, 0], ['low', 'medium'], [40, 60, 0, 0, 0],
    ])
    const old = restored({ buckets: [{ at: 0, n: [1, 0, 0, 2], tok: [10, 0, 0, 20] }] }, 1_000)
    expect(old?.buckets[0].n, 'low.test.ts:C2-old').toEqual([0, 1, 0, 0, 2])
    expect(usageLine(undefined, { calls: 2, tokens: [400, 600, 0, 0, 0] }).includes('low 0.4k, medium 0.6k'), 'low.test.ts:C2-usage').toBe(true)
  })

  test('B1 an hour into a new week with no recent rate, 1% used is too early to read a pace, not over budget', () => {
    const resets = new Date(167 * H).toISOString()
    const b = weeklyBudget([{ kind: 'seven_day', percentUsed: 1, resetsAt: resets }], 0)
    expect([b?.basis, overBudget(b), usageLine(b).includes('too early in the week to read a pace')], 'low.test.ts:B1').toEqual(['early', false, true])
    const later = weeklyBudget([{ kind: 'seven_day', percentUsed: 20, resetsAt: new Date(150 * H).toISOString() }], 0)
    expect([later?.basis, overBudget(later)], 'low.test.ts:B1-after-12h').toEqual(['week', true])
  })
})
