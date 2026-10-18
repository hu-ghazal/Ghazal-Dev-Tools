import { describe, expect, mock, test } from 'claude-code/testing'

import { bold, levelName, statusText, topLevel } from './classify'


const SIMPLE = 'rename the variable foo to bar in utils.ts'

// Claude answers EFFORT (max unless told otherwise) before the step; there is no 7-day reading, so no weekly cap.
const answer = ($: any, effort: string) => $.tool.call({ tool: 'Bash', command: `echo "EFFORT=${effort}"` })
function harness(on: any) {
  const efforts: (string | undefined)[] = []
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('turn.step', async function* ($: any, e: any) {
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return efforts
}

async function step($: any, model: string, effort = 'medium') {
  const s = $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1 })
  for await (const _ of s) void _
}

describe('fable', () => {
  test('Opus, Fable and Sonnet 5+ all reach max; other models are left alone', () => {
    expect([topLevel('claude-opus-5-5'), topLevel('claude-fable-5-1'), topLevel('claude-sonnet-5-5')], 'fable.test.ts:28').toEqual([3, 3, 3])
    // By family and version, not one id.
    const ids = ['claude-opus-5', 'claude-opus-6-1', 'claude-opus-6-20270101', 'claude-fable-5-1[1m]', 'claude-fable-7', 'CLAUDE-FABLE-5-2',
      'claude-opus-4-1', 'claude-fable-4', 'claude-opus-4-20250514', 'claude-3-opus-20240229', 'claude-haiku-5-5', 'claude-opus-55', 'notopus-5-5',
      'claude-sonnet-4-5', 'claude-sonnet-6']
    expect(ids.map(topLevel), 'fable.test.ts:32').toEqual([3, 3, 3, 3, 3, 3, undefined, undefined, undefined, undefined, undefined, 3, undefined, undefined, 3])
  })

  test('on Fable and Sonnet a max answer sends max', async ($, on) => {
    mock.clock(on)
    const efforts = harness(on)
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    await answer($, 'max')
    await step($, 'claude-fable-5-1')
    await step($, 'claude-sonnet-5-5')
    expect(efforts, 'fable.test.ts:40').toEqual(['max', 'max'])
  })

  test('on Opus 5.5 the same answer sends max', async ($, on) => {
    mock.clock(on)
    const efforts = harness(on)
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    await answer($, 'max')
    await step($, 'claude-opus-5-5')
    expect(efforts, 'fable.test.ts:48').toEqual(['max'])
  })

  test('the session own setting does not pin the effort: a Fable session set to xhigh goes to medium', async ($, on) => {
    mock.clock(on)
    const efforts = harness(on)
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    await answer($, 'medium')
    await step($, 'claude-fable-5-1', 'xhigh')
    expect(efforts, 'fable.test.ts:56').toEqual(['medium'])
  })

  test('the status line names the model and its highest effort', () => {
    expect([statusText('high', 'claude-opus-5-5'), statusText('xhigh', 'claude-fable-5-1')], 'fable.test.ts:60').toEqual([`${bold('High')} (up to Max)`, `${bold('Extra High')} (up to Max)`])
  })

  test('the same for Opus 5.5: a session set to max goes to medium when the job is easy', async ($, on) => {
    mock.clock(on)
    const efforts = harness(on)
    await $.turn.start({ turnId: 't1', text: SIMPLE })
    await answer($, 'medium')
    await step($, 'claude-opus-5-5', 'max')
    expect(efforts, 'fable.test.ts:68').toEqual(['medium'])
  })

  test('effort names start with a capital and the level is bold by its letters', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max'].map(levelName), 'fable.test.ts:72').toEqual(['Low', 'Medium', 'High', 'Extra High', 'Max'])
    expect(Array.from(bold('Hi Z9')).map(c => c.codePointAt(0)), 'fable.test.ts:73').toEqual([0x1d5db, 0x1d5f6, 32, 0x1d5ed, 57])
  })
})
