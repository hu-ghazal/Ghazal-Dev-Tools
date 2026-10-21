import { describe, expect, mock, test } from 'claude-code/testing'

import { fastAsk, fastCardText, fastNote, fastWanted, parseFastMode, weeklyBudget } from './classify'

// Fast mode at Medium: an unchecked Settings option. Checked, fast mode is on only at Medium with the week under budget.
// The card follows Claude's own switch call and the app's own report, with no word back from Claude.

const OPUS = 'claude-opus-5-5'
const H = 3600_000
const PANE = { component: 'Pane', requestId: 'adaptive-effort', props: { title: 'Thinking effort' }, viewport: { columns: 60, rows: 20 } } as any
// The mocked clock starts at 0: a reset 96 h ahead leaves 4 days, 72 h of the week gone. 10% used is under budget,
// 60% is over.
const RESETS = new Date(96 * H).toISOString()
const week = (used: number) => [{ kind: 'seven_day', percentUsed: used, resetsAt: RESETS }]
const ANSWER = (effort: string) => `echo "EFFORT=${effort}"`
const SWITCH = 'mcp__ccd_session_mgmt__set_session_fast_mode'
const GET = 'mcp__ccd_session_mgmt__get_session'

// The app as the desktop gives it: what get_session reports (fastMode, absent until reported), whether the permission
// check allows reading it outright, whether a switch is accepted, and how many times the mod read it.
type App = { fast?: unknown; check: string; refuse: boolean; reads: number }
const app = (x: Partial<App> = {}): App => ({ check: 'allow', refuse: false, reads: 0, ...x })

function harness(on: any, usage: { used: number }, a: App = app({ check: 'deny' })) {
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'adaptive-effort' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits: week(usage.used) } }))
  on('tool.check', () => ({ decision: a.check }))
  on('tool.call', ($: any, e: any) => {
    if (e.tool === GET) {
      a.reads++
      return { result: {}, text: JSON.stringify({ sessionId: 'local_1', ...(a.fast === undefined ? {} : { fastMode: a.fast }) }) }
    }
    if (e.tool === SWITCH) return a.refuse ? { isError: true, result: 'refused', text: 'Fast mode was not changed for this session.' } : { result: {}, text: 'Asked this session to turn fast mode on.' }
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
  on('turn.step', async function* ($: any, e: any) {
    const u = { input_tokens: 2, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: OPUS }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
}

const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
// The fast-mode note an answer brings: 'on', 'off' or '' for none.
async function note($: any, effort: string) {
  const r: any = await $.tool.call({ tool: 'Bash', command: ANSWER(effort) })
  const t = (r?.context ?? []).join('\n')
  return t.includes('fast mode on') ? 'on' : t.includes('fast mode off') ? 'off' : ''
}
// Claude's own switch call, as the note asks for it.
const flip = ($: any, enabled: boolean, session = 'self') => $.tool.call({ tool: SWITCH, session_id: session, enabled })
const prompt = async ($: any) => ((await $.prompt.submit({ text: 'go' } as any))?.context ?? []) as string[]

// The pane with the box checked and the cards in view; card() reads the Medium pill, why() the line beside it.
async function checkedPane($: any) {
  const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'fast' })
  await ui.press({ key: 'settings' })
  return {
    ui,
    card: async () => ((await ui.find({ type: 'Text', text: ' Medium-Fast ' })) !== undefined ? 'fast' : 'plain'),
    why: async () => {
      for (const t of ['fast cooling down', 'fast off: extra usage disabled', 'fast off: sdk opt in required']) if ((await ui.find({ type: 'Text', text: t })) !== undefined) return t
      return ''
    },
  }
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

  test("F3 the card follows Claude's own switch at once: accepted on green, accepted off plain, refused plain and asked again", async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const a = app({ check: 'deny' })
    harness(on, { used: 10 }, a)
    await start($)
    const { card } = await checkedPane($)
    expect([await note($, 'medium'), await card()], 'fast.test.ts:F3-asked').toEqual(['on', 'plain'])
    await flip($, true)
    expect([await card(), await note($, 'medium')], 'fast.test.ts:F3-accepted').toEqual(['fast', ''])
    expect(await note($, 'high'), 'fast.test.ts:F3-high').toBe('off')
    await flip($, false)
    expect([await card(), await note($, 'high')], 'fast.test.ts:F3-off').toEqual(['plain', ''])
    expect(await note($, 'medium'), 'fast.test.ts:F3-medium-again').toBe('on')
    a.refuse = true
    await flip($, true)
    expect([await card(), await note($, 'medium')], 'fast.test.ts:F3-refused').toEqual(['plain', 'on'])
    a.refuse = false
    await flip($, true, 'local_other')
    expect(await card(), 'fast.test.ts:F3-other-session').toBe('plain')
    expect(a.reads, 'fast.test.ts:F3-no-dialog-no-read').toBe(0)
  })

  test('F4 the on note asks only for the switch; Claude reports nothing back', () => {
    expect([fastNote(true).endsWith('enabled true now.'), fastNote(true).includes('FAST='), fastNote(false).includes('FAST=')], 'fast.test.ts:F4-note').toEqual([true, false, false])
  })

  test('F5 nothing about fast mode beside any prompt; unchecked, the app is never read', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const a = app({ fast: { state: 'on' } })
    harness(on, { used: 10 }, a)
    await start($)
    const unchecked = await prompt($)
    expect([a.reads, unchecked.some(x => x.includes('fast mode'))], 'fast.test.ts:F5-unchecked').toEqual([0, false])
    await checkedPane($)
    const checked = await prompt($)
    expect([a.reads, checked.some(x => x.includes('fast mode'))], 'fast.test.ts:F5-checked').toEqual([1, false])
  })

  test('F6 the card shows what the app reports, and no note asks for what cannot run', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const a = app()
    harness(on, { used: 10 }, a)
    await start($)
    const { ui, card, why } = await checkedPane($)
    const state = async (fast: unknown) => {
      a.fast = fast
      await prompt($)
      return [await card(), await why(), await note($, 'medium')]
    }
    expect(await state({ state: 'on' }), 'fast.test.ts:F6-on').toEqual(['fast', '', ''])
    expect(await state({ state: 'cooldown' }), 'fast.test.ts:F6-cooldown').toEqual(['plain', 'fast cooling down', ''])
    expect(await state({ state: 'off', disabledReason: 'extra_usage_disabled' }), 'fast.test.ts:F6-blocked').toEqual(['plain', 'fast off: extra usage disabled', ''])
    expect(await state({ state: 'off' }), 'fast.test.ts:F6-off-asks').toEqual(['plain', '', 'on'])
    expect(await note($, 'medium'), 'fast.test.ts:F6-once').toBe('')
    expect(await state(undefined), 'fast.test.ts:F6-unreported-keeps').toEqual(['plain', '', ''])
    // A refusal reads the app's reason at once, so the next Medium answer does not ask again.
    a.fast = { state: 'off', disabledReason: 'extra_usage_disabled' }
    a.refuse = true
    const before = a.reads
    await flip($, true)
    expect([await card(), await why(), a.reads - before, await note($, 'medium')], 'fast.test.ts:F6-refused-reason').toEqual(['plain', 'fast off: extra usage disabled', 1, ''])
    // Unchecked, the card is plain Medium whatever was seen.
    a.fast = { state: 'on' }
    await prompt($)
    expect(await card(), 'fast.test.ts:F6-on-again').toBe('fast')
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'fast' })
    await ui.press({ key: 'settings' })
    expect([await card(), await why(), (await ui.find({ type: 'Text', text: ' Medium ' })) !== undefined], 'fast.test.ts:F6-unchecked-plain').toEqual(['plain', '', true])
  })

  test('F7 after an accepted switch the app is read only once a whole turn has run; a dialog is never opened', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const a = app({ fast: { state: 'off' } })
    harness(on, { used: 10 }, a)
    await start($)
    const { card } = await checkedPane($)
    await prompt($)
    expect(await note($, 'medium'), 'fast.test.ts:F7-asked').toBe('on')
    await flip($, true)
    const reads = a.reads
    await prompt($)
    expect([await card(), a.reads - reads], 'fast.test.ts:F7-held').toEqual(['fast', 0])
    await $.turn.start({ turnId: 't2', text: 'go' })
    await prompt($)
    expect([await card(), a.reads - reads, await note($, 'medium')], 'fast.test.ts:F7-after-turn').toEqual(['plain', 1, 'on'])
    a.check = 'ask'
    await prompt($)
    expect(a.reads - reads, 'fast.test.ts:F7-no-dialog').toBe(1)
  })

  test('F8 the pieces: fastMode parsed only as the app gives it; one note per thing seen; the reason in plain words', () => {
    expect([parseFastMode('{"fastMode":{"state":"cooldown"}}', 5), parseFastMode('{"fastMode":{"state":"off","disabledReason":"sdk_opt_in_required"}}', 6)], 'fast.test.ts:F8-parse').toEqual([
      { mode: 'cooldown', from: 'app', at: 5 },
      { mode: 'off', reason: 'sdk_opt_in_required', from: 'app', at: 6 },
    ])
    expect([parseFastMode('{"sessionId":"x"}', 1), parseFastMode('not json', 1), parseFastMode('{"fastMode":{"state":"fast"}}', 1), parseFastMode(undefined, 1)], 'fast.test.ts:F8-none').toEqual([undefined, undefined, undefined, undefined])
    const off = { mode: 'off', from: 'app', at: 10 } as const
    expect([fastAsk(true, undefined, false, undefined), fastAsk(true, true, true, undefined), fastAsk(true, true, false, off), fastAsk(true, true, true, off), fastAsk(false, true, false, off), fastAsk(false, true, false, { ...off, mode: 'on' }), fastAsk(undefined, true, false, off)], 'fast.test.ts:F8-ask').toEqual([true, undefined, true, undefined, undefined, false, undefined])
    expect([fastCardText({ ...off, reason: 'extra_usage_disabled' }), fastCardText({ ...off, mode: 'cooldown' }), fastCardText(off), fastCardText(undefined)], 'fast.test.ts:F8-text').toEqual(['fast off: extra usage disabled', 'fast cooling down', undefined, undefined])
  })
})
