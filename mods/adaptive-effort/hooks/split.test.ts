import { describe, expect, mock, test } from 'claude-code/testing'

import { parseSplitAnswer, splitGate } from './classify'

// Operator 2026-10-16: "we can add this as an option in setting default unchecked experimental. Claude decide by score
// x/10 the multiply by risk 0.9 the if final score > 0.7 then it pass" and "claude is blindly scoring out of ten! then
// the calculation x 0.9 is the gate to go".

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

  test('S2 the gate is SPLIT/10 x 0.9 over 0.7: 8 passes at 0.72, 7 fails at 0.63, 10 passes at 0.9', () => {
    expect([10, 9, 8, 7, 0].map(splitGate), 'split.test.ts:S2').toEqual([
      { value: 0.9, pass: true }, { value: 0.81, pass: true }, { value: 0.72, pass: true }, { value: 0.63, pass: false }, { value: 0, pass: false },
    ])
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

  test('S4 on from Settings: the rule goes beside the prompt, 8 sends High, 7 and no score leave Max, and new sessions keep it on', async ($, on) => {
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
    const pass = await answerMax($, clock, efforts as string[], ' SPLIT=8', 1)
    expect([pass.sent, pass.note.includes('split 8/10 x 0.9 = 0.72 > 0.7: split')], 'split.test.ts:S4-pass').toEqual(['high', true])
    const fail = await answerMax($, clock, efforts as string[], ' SPLIT=7', 2)
    expect([fail.sent, fail.note.includes('0.63 not over 0.7: no split; Max stands')], 'split.test.ts:S4-fail').toEqual(['max', true])
    const none = await answerMax($, clock, efforts as string[], '', 3)
    expect([none.sent, none.note.includes('split')], 'split.test.ts:S4-no-score').toEqual(['max', false])
    await start($)
    const next: any = await $.prompt.submit({ text: 'next session' } as any)
    expect((next?.context ?? []).join('\n').includes('experimental split (on)'), 'split.test.ts:S4-kept').toBe(true)
  })
})
