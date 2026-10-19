import { describe, expect, mock, test } from 'claude-code/testing'

import { fastNote, fastWanted, parseFastOff, parseFastReport, weeklyBudget } from './classify'

// Fast mode at Medium: an unchecked Settings option. Checked, fast mode is on only at Medium with the week under budget.

const OPUS = 'claude-opus-5-5'
const H = 3600_000
const PANE = { component: 'Pane', requestId: 'adaptive-effort', props: { title: 'Thinking effort' }, viewport: { columns: 60, rows: 20 } } as any
// The mocked clock starts at 0: a reset 96 h ahead leaves 4 days, 72 h of the week gone. 10% used is under budget,
// 60% is over.
const RESETS = new Date(96 * H).toISOString()
const week = (used: number) => [{ kind: 'seven_day', percentUsed: used, resetsAt: RESETS }]
const ANSWER = (effort: string, extra = '') => `echo "EFFORT=${effort}${extra}"`

function harness(on: any, usage: { used: number }) {
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'adaptive-effort' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits: week(usage.used) } }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
  on('turn.step', async function* ($: any, e: any) {
    const u = { input_tokens: 2, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: OPUS }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
}

const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
// The fast-mode note an answer brings: 'on', 'off' or '' for none.
async function note($: any, effort: string, extra = '') {
  const r: any = await $.tool.call({ tool: 'Bash', command: ANSWER(effort, extra) })
  const t = (r?.context ?? []).join('\n')
  return t.includes('fast mode on') ? 'on' : t.includes('fast mode off') ? 'off' : ''
}

describe('fast mode at Medium', () => {
  test('F1 fast only at Medium with the week under budget; any other effort, over budget or no reading is off', () => {
    const under = weeklyBudget(week(10), 0)
    const over = weeklyBudget(week(60), 0)
    expect([0, 1, 2, 3].map(l => fastWanted(l, under)), 'fast.test.ts:F1-levels').toEqual([true, false, false, false])
    expect([fastWanted(0, over), fastWanted(0, undefined)], 'fast.test.ts:F1-budget').toEqual([false, false])
  })

  test('F2 unchecked by default; checked, a note at each change only; over budget off; unchecked after on, one off; kept for new sessions', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const usage = { used: 10 }
    harness(on, usage)
    await start($)
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    await ui.press({ key: 'settings' })
    expect([(await ui.find({ type: 'Button', key: 'fast' }))?.props?.label, (await ui.find({ type: 'Text', text: 'Fast mode at Medium' })) !== undefined], 'fast.test.ts:F2-unchecked').toEqual(['☐', true])
    expect(await note($, 'medium'), 'fast.test.ts:F2-off-no-note').toBe('')
    await ui.press({ key: 'fast' })
    expect((await ui.find({ type: 'Button', key: 'fast' }))?.props?.label, 'fast.test.ts:F2-checked').toBe('☑')
    expect([await note($, 'medium'), await note($, 'medium'), await note($, 'high'), await note($, 'max'), await note($, 'medium')], 'fast.test.ts:F2-changes').toEqual(['on', '', 'off', '', 'on'])
    usage.used = 60
    expect([await note($, 'medium'), await note($, 'medium')], 'fast.test.ts:F2-over').toEqual(['off', ''])
    usage.used = 10
    expect(await note($, 'medium'), 'fast.test.ts:F2-under-again').toBe('on')
    await ui.press({ key: 'fast' })
    expect([await note($, 'medium'), await note($, 'medium')], 'fast.test.ts:F2-unchecked-after-on').toEqual(['off', ''])
    await ui.press({ key: 'fast' })
    await ui.unmount()
    await start($)
    expect(await note($, 'medium'), 'fast.test.ts:F2-kept').toBe('on')
  })

  test('F4 the on note asks for FAST=off when the switch is refused or fast mode is still off at the next echo', () => {
    const n = fastNote(true)
    expect([n.includes('If that call is refused'), n.includes('get_session for this session shows fastMode not on'), fastNote(false).includes('FAST=off')], 'fast.test.ts:F4-note').toEqual([true, true, false])
  })

  test('F3 Medium-Fast only after FAST=on confirms it; FAST=off drops it and the next Medium asks again', async ($, on) => {
    expect([' FAST=off', ' fast=off"', ' FAST=on', ' XFAST=off', ''].map(x => parseFastOff(ANSWER('medium', x))), 'fast.test.ts:F3-parse').toEqual([true, true, false, false, false])
    expect(parseFastOff('ls FAST=off'), 'fast.test.ts:F3-echo-only').toBe(false)
    mock.clock(on)
    mock.store(on)
    harness(on, { used: 10 })
    await start($)
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'fast' })
    await ui.press({ key: 'settings' })
    const card = async () => ((await ui.find({ type: 'Text', text: ' Medium-Fast ' })) !== undefined ? 'fast' : 'plain')
    expect([await note($, 'medium'), await card()], 'fast.test.ts:F3-on').toEqual(['on', 'plain'])
    expect([await note($, 'medium', ' FAST=on'), await card()], 'fast.test.ts:F3-confirmed').toEqual(['', 'fast'])
    expect([await note($, 'medium', ' FAST=off'), await card()], 'fast.test.ts:F3-refused').toEqual(['', 'plain'])
    expect([await note($, 'medium'), await card()], 'fast.test.ts:F3-retry').toEqual(['on', 'plain'])
    expect([await note($, 'high', ' FAST=on'), await card()], 'fast.test.ts:F3-high-not-confirmed').toEqual(['off', 'plain'])
    expect([parseFastReport(ANSWER('medium', ' FAST=on')), parseFastReport(ANSWER('medium', ' FAST=on FAST=off')), parseFastReport('ls FAST=on')], 'fast.test.ts:F3-report').toEqual(['on', 'off', undefined])
  })

  test('F5 while fast mode is asked on, each prompt carries the check line; otherwise none', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    harness(on, { used: 10 })
    await start($)
    const check = async () => ((await $.prompt.submit({ text: 'go' } as any))?.context ?? []).some((x: string) => x.includes('fast mode was asked on'))
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'fast' })
    expect(await check(), 'fast.test.ts:F5-not-asked').toBe(false)
    await note($, 'medium')
    expect(await check(), 'fast.test.ts:F5-asked').toBe(true)
    await note($, 'medium', ' FAST=off')
    expect(await check(), 'fast.test.ts:F5-cleared').toBe(false)
  })
})
