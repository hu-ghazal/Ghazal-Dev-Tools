import { describe, expect, mock, test } from 'claude-code/testing'

import { parseSplitAnswer, splitGate, splitText } from './classify'

// Break to simple (experimental): an unchecked Settings option. Claude scores out of ten without deliberating; the step
// splits at a score of the trigger or more, 7 by default and set from 1 to 10 in Settings.

const OPUS = 'claude-opus-5-5'
const PANE = { component: 'Pane', requestId: 'adaptive-effort', props: { title: 'Thinking effort' }, viewport: { columns: 60, rows: 20 } } as any
const ANSWER = (effort: string, extra = '') => `echo "EFFORT=${effort}${extra}"`

function harness(on: any) {
  const efforts: (string | undefined)[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'adaptive-effort' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits: [] } }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
  on('turn.step', async function* ($: any, e: any) {
    efforts.push(e.effort)
    const usage = { input_tokens: 2, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: OPUS }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  return efforts
}

async function step($: any, index: number) {
  for await (const _ of $.turn.step({ turnId: 't1', index, model: OPUS, effort: 'medium', messageCount: 1 })) void _
}
const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })

// One answer of max with the given extra tokens, then the next step: the effort that step was sent at.
async function answerMax($: any, clock: any, efforts: string[], extra: string, index: number) {
  const r: any = await $.tool.call({ tool: 'Bash', command: ANSWER('max', extra) })
  await clock.advance(61_000)
  await step($, index)
  return { sent: efforts.at(-1), note: (r?.context ?? []).join('\n') }
}

describe('experimental split before Max', () => {
  test('S1 the score is read only as SPLIT=0..10 on the first line of an echo', () => {
    expect([' SPLIT=8', ' SPLIT=10', ' SPLIT=0', ' split=7', ' SPLIT=8"', ' SPLIT=8.'].map(x => parseSplitAnswer(ANSWER('max', x))), 'split.test.ts:S1-valid').toEqual([8, 10, 0, 7, 8, 8])
    expect([' SPLIT=11', ' SPLIT=8.5', ' SPLIT=08', ' SPLIT=-1', ' XSPLIT=9', ' SPLIT=', ''].map(x => parseSplitAnswer(ANSWER('max', x))), 'split.test.ts:S1-invalid').toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined])
    expect([parseSplitAnswer('printf "SPLIT=9"'), parseSplitAnswer('echo "a"\necho "SPLIT=9"'), parseSplitAnswer(undefined)], 'split.test.ts:S1-not-echo').toEqual([undefined, undefined, undefined])
  })

  test('S2 the gate is the score at the trigger or more: at the default 7, 7 splits and 6 does not; at 5, 5 splits and 4 does not', () => {
    expect([10, 7, 6, 0].map(s => splitGate(s).pass), 'split.test.ts:S2-default').toEqual([true, true, false, false])
    expect([splitGate(5, 5).pass, splitGate(4, 5).pass, splitGate(10, 10).pass, splitGate(9, 10).pass], 'split.test.ts:S2-trigger').toEqual([true, false, true, false])
    expect([splitText(7), splitText(6), splitText(5, 5)], 'split.test.ts:S2-text').toEqual(['split score 7/10 at or over 7', 'split score 6/10 under 7', 'split score 5/10 at or over 5'])
  })

  test('S3 off by default: no rule beside the prompt and max is sent whatever the score', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const efforts = harness(on)
    await start($)
    const sent: any = await $.prompt.submit({ text: 'go' } as any)
    expect((sent?.context ?? []).join('\n').includes('experimental split'), 'split.test.ts:S3-no-rule').toBe(false)
    await $.turn.start({ turnId: 't1', text: 'go' })
    await step($, 0)
    const r = await answerMax($, clock, efforts as string[], ' SPLIT=9', 1)
    expect([r.sent, r.note.includes('split')], 'split.test.ts:S3-max').toEqual(['max', false])
  })

  test('S4 on from Settings: the rule goes beside the prompt, 7 sends High, 6 and no score leave Max, and new sessions keep it on', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const efforts = harness(on)
    await start($)
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    await ui.press({ key: 'settings' })
    expect([(await ui.find({ type: 'Button', key: 'split' }))?.props?.label, (await ui.find({ type: 'Text', text: 'Break to simple (experimental)' }))?.props?.color], 'split.test.ts:S4-unchecked').toEqual(['☐', '#F2C94C'])
    await ui.press({ key: 'split' })
    expect((await ui.find({ type: 'Button', key: 'split' }))?.props?.label, 'split.test.ts:S4-checked').toBe('☑')
    await ui.unmount()
    const sent: any = await $.prompt.submit({ text: 'go' } as any)
    expect((sent?.context ?? []).join('\n').includes('experimental split (on)'), 'split.test.ts:S4-rule').toBe(true)
    await $.turn.start({ turnId: 't1', text: 'go' })
    await step($, 0)
    const pass = await answerMax($, clock, efforts as string[], ' SPLIT=7', 1)
    expect([pass.sent, pass.note.includes('split score 7/10 at or over 7: split')], 'split.test.ts:S4-pass').toEqual(['high', true])
    const fail = await answerMax($, clock, efforts as string[], ' SPLIT=6', 2)
    expect([fail.sent, fail.note.includes('split score 6/10 under 7: no split; Max stands')], 'split.test.ts:S4-fail').toEqual(['max', true])
    const none = await answerMax($, clock, efforts as string[], '', 3)
    expect([none.sent, none.note.includes('split')], 'split.test.ts:S4-no-score').toEqual(['max', false])
    await start($)
    const next: any = await $.prompt.submit({ text: 'next session' } as any)
    expect((next?.context ?? []).join('\n').includes('experimental split (on)'), 'split.test.ts:S4-kept').toBe(true)
  })

  test('S5 the trigger is set beside Break to simple with - and +, from 1 to 10, used by the gate and kept for new sessions', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const efforts = harness(on)
    await start($)
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    await ui.press({ key: 'settings' })
    const trigger = async () => (await ui.find({ type: 'Text', text: /^(?:[1-9]|10)$/ }))?.text
    expect([await trigger(), (await ui.find({ type: 'Text', text: 'Break to simple at a score of at least' })) !== undefined], 'split.test.ts:S5-default').toEqual(['7', true])
    await ui.press({ key: 'split' })
    await ui.press({ key: 'split-down' })
    await ui.press({ key: 'split-down' })
    expect(await trigger(), 'split.test.ts:S5-down').toBe('5')
    await ui.unmount()
    const sent: any = await $.prompt.submit({ text: 'go' } as any)
    expect((sent?.context ?? []).join('\n').includes('A score of 5 or more runs the step at High'), 'split.test.ts:S5-rule').toBe(true)
    await $.turn.start({ turnId: 't1', text: 'go' })
    await step($, 0)
    const pass = await answerMax($, clock, efforts as string[], ' SPLIT=5', 1)
    expect([pass.sent, pass.note.includes('split score 5/10 at or over 5: split')], 'split.test.ts:S5-pass').toEqual(['high', true])
    const fail = await answerMax($, clock, efforts as string[], ' SPLIT=4', 2)
    expect([fail.sent, fail.note.includes('split score 4/10 under 5: no split; Max stands')], 'split.test.ts:S5-fail').toEqual(['max', true])
    await start($)
    const next: any = await $.prompt.submit({ text: 'next session' } as any)
    expect((next?.context ?? []).join('\n').includes('A score of 5 or more runs the step at High'), 'split.test.ts:S5-kept').toBe(true)
    const again: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    // Settings is still open from the first pane: Done and Settings are one button.
    for (let i = 0; i < 9; i++) await again.press({ key: 'split-down' })
    const low = (await again.find({ type: 'Text', text: /^(?:[1-9]|10)$/ }))?.text
    for (let i = 0; i < 12; i++) await again.press({ key: 'split-up' })
    expect([low, (await again.find({ type: 'Text', text: /^(?:[1-9]|10)$/ }))?.text], 'split.test.ts:S5-bounds').toEqual(['1', '10'])
  })
})
