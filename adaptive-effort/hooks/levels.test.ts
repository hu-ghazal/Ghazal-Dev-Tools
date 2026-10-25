import { describe, expect, mock, test } from 'claude-code/testing'

import { countsIn, levelRules, parseEffortAnswer, rulesLine, STANDARD } from './classify'
import { EMPTY_CHART, recordStep } from './chart'


const OPUS = 'claude-opus-5-5'
const MIN = 60_000
const ANSWER = (effort: string) => `echo "EFFORT=${effort}"`

function harness(on: any): (string | undefined)[] {
  const efforts: (string | undefined)[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'adaptive-effort' } }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits: [] } }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
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
const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
const prompt = ($: any) => $.turn.start({ turnId: 't1', text: 'next request' })
const answer = ($: any, effort: string) => $.tool.call({ tool: 'Bash', command: ANSWER(effort) })
const command = ($: any) =>
  $.command.run({ command: 'adaptive-effort', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

describe('design escalation, the xhigh cap and low', () => {
  test('L1 EFFORT=low is read as level -1; the unanswered template and other words are no answer', () => {
    expect(
      [parseEffortAnswer(ANSWER('low')), parseEffortAnswer(ANSWER('low|medium|high|xhigh|max')), parseEffortAnswer(ANSWER('lowest')), parseEffortAnswer(ANSWER('medium'))],
      'levels.test.ts:L1',
    ).toEqual([-1, undefined, undefined, 0])
  })

  test('L2 an answer of low is sent as low', async ($, on) => {
    mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    expect(efforts, 'levels.test.ts:L2').toEqual(['low'])
  })

  test('X1 xhigh runs at most 10 minutes, then medium until a new prompt, and /adaptive-effort says so', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'xhigh')
    await step($, 0)
    await clock.advance(10 * MIN - 1)
    await step($, 1)
    await clock.advance(1)
    await step($, 2)
    await answer($, 'xhigh')
    await clock.advance(MIN)
    await step($, 3)
    expect(efforts, 'levels.test.ts:X1-cap').toEqual(['xhigh', 'xhigh', 'medium', 'medium'])
    const text = JSON.stringify(await command($))
    expect([text.includes('Extra high ran 10 minutes and is held at medium until a new prompt'), text.includes('xhigh and max each run at most 10 minutes')], 'levels.test.ts:X1-shown').toEqual([true, true])
    await prompt($)
    await step($, 0)
    expect(efforts.at(-1), 'levels.test.ts:X1-new-prompt').toBe('xhigh')
  })

  test('D1 a design flaw found is an xhigh condition; one a fix did not resolve, or a redesign, is a max condition', () => {
    const r = levelRules(countsIn(STANDARD, false))
    expect(
      [r.xhigh.some(x => x.code.includes('design or architecture flaw found')), r.max.some(x => x.code.includes('a fix did not resolve')), r.max.some(x => x.general.includes('how a whole system is built'))],
      'levels.test.ts:D1',
    ).toEqual([true, true, true])
  })

  test('D2 the rules line names when low fits, after the four levels', () => {
    const line = rulesLine(STANDARD, undefined)
    expect([line.includes('low: questions, a one-to-one back-and-forth conversation'), line.indexOf('medium:') < line.indexOf('low:')], 'levels.test.ts:D2').toEqual([true, true])
  })

  test('C1 the chart counts a low step in its own column', () => {
    const log = recordStep(EMPTY_CHART, 'low' as any, 1_000_000, 40)
    const b = log.buckets.at(-1)
    expect([b?.n[0], b?.tok?.[0], b?.n[1]], 'levels.test.ts:C1').toEqual([1, 40, 0])
  })
})
