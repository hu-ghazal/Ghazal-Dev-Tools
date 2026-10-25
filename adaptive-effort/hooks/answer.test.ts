import { describe, expect, mock, test } from 'claude-code/testing'

import { parseEffortAnswer } from './classify'
import { manifest } from './version'


const OPUS = 'claude-opus-5-5'
const MIN = 60_000
const ANSWER = (effort: string) => `echo "EFFORT=${effort}"`

type Seen = { efforts: (string | undefined)[]; modelCalls: number; registered: number }

function harness(on: any, rateLimits: unknown[] = []): Seen {
  const seen: Seen = { efforts: [], modelCalls: 0, registered: 0 }
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'adaptive-effort' } }))
  on('tool.register', () => { seen.registered += 1; return { value: { tool: 'x' } } })
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits } }))
  on('model.complete', () => { seen.modelCalls += 1; return { value: { isAnswered: true, text: '3', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } })
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('turn.step', async function* ($: any, e: any) {
    seen.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return seen
}

async function step($: any, index: number, extra: Record<string, unknown> = {}) {
  const s = $.turn.step({ turnId: 't1', index, model: OPUS, effort: 'medium', messageCount: 1, ...extra })
  for await (const _ of s) void _
}
const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
const prompt = ($: any, text = 'next request') => $.turn.start({ turnId: 't1', text })
const answer = ($: any, effort: string, extra: Record<string, unknown> = {}) => $.tool.call({ tool: 'Bash', command: ANSWER(effort), ...extra })
const command = ($: any, args = '') =>
  $.command.run({ command: 'adaptive-effort', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

describe('the answer', () => {
  test('EFFORT is read from an echo of EFFORT=<level> only', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max'].map(l => parseEffortAnswer(ANSWER(l))), 'answer.test.ts:parse-levels').toEqual([-1, 0, 1, 2, 3])
    expect([
      parseEffortAnswer('echo "note=yes EFFORT=MAX."'),
      parseEffortAnswer("echo 'EFFORT=high'"),
      parseEffortAnswer('  echo "EFFORT=high" && ls'),
      parseEffortAnswer('echo "EFFORT=xhigh"\necho "EFFORT=max"'),
      parseEffortAnswer('echo "EFFORT=high EFFORT=medium"'),
      parseEffortAnswer('echo EFFORT=max'),
    ], 'answer.test.ts:parse-forms').toEqual([3, 1, 1, 2, 0, 3])
    expect([
      parseEffortAnswer(ANSWER('medium|high|xhigh|max')),
      parseEffortAnswer(ANSWER('low|medium|high|xhigh|max')),
      parseEffortAnswer(ANSWER('')),
      parseEffortAnswer('echo "note=yes other=no"'),
      parseEffortAnswer('grep "EFFORT=max" log.txt'),
      parseEffortAnswer('cat x; echo "EFFORT=max"'),
      parseEffortAnswer('echo "NOEFFORT=max XEFFORT=max"'),
      parseEffortAnswer(undefined),
      parseEffortAnswer(42),
    ], 'answer.test.ts:parse-not-answers').toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined])
  })
})

describe('Claude decides its effort', () => {
  test('no model call, no tool and no keyword: a hard-sounding prompt with no answer stays medium', async ($, on) => {
    mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($, 'redesign the architecture: a race condition crashes again across services, root cause unknown')
    await step($, 0)
    await step($, 1)
    expect(seen.efforts, 'answer.test.ts:no-keyword').toEqual(['medium', 'medium'])
    expect([seen.modelCalls, seen.registered], 'answer.test.ts:no-call-no-tool').toEqual([0, 0])
  })

  test('an answer applies from the next step once the current effort has stood 60 s, up or down (think harder, think less)', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await step($, 0)
    await answer($, 'max')
    await clock.advance(MIN - 1)
    await step($, 1)
    await clock.advance(1)
    await step($, 2)
    expect(seen.efforts, 'answer.test.ts:harder').toEqual(['medium', 'medium', 'max'])
    await answer($, 'medium')
    await clock.advance(MIN - 1)
    await step($, 3)
    expect(seen.efforts.at(-1), 'answer.test.ts:hold').toBe('max')
    await clock.advance(1)
    await step($, 4)
    expect(seen.efforts.at(-1), 'answer.test.ts:less').toBe('medium')
    expect(seen.modelCalls, 'answer.test.ts:still-no-call').toBe(0)
  })

  test('the answer holds across prompts until Claude answers again', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await step($, 0)
    await answer($, 'high')
    await clock.advance(MIN)
    await prompt($, 'a quite different new request')
    await step($, 0)
    expect(seen.efforts.at(-1), 'answer.test.ts:holds').toBe('high')
    await answer($, 'xhigh')
    await clock.advance(MIN)
    await step($, 1)
    expect(seen.efforts.at(-1), 'answer.test.ts:re-answer').toBe('xhigh')
  })

  test('other Bash calls, a subagent\'s answer and an answer while the mod is off change nothing', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await step($, 0)
    await $.tool.call({ tool: 'Bash', command: 'grep "EFFORT=max" notes.txt' })
    await answer($, 'max', { agentId: 'sub-1' })
    await command($, 'off')
    await answer($, 'max')
    await command($, 'on')
    await clock.advance(MIN)
    await step($, 1)
    expect(seen.efforts, 'answer.test.ts:ignored').toEqual(['medium', 'medium'])
  })

  test('subagent steps and other models are left alone', async ($, on) => {
    mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0, { agentId: 'sub-1', effort: 'low' })
    await step($, 1, { model: 'claude-haiku-5-5', effort: 'low' })
    expect(seen.efforts, 'answer.test.ts:untouched').toEqual(['low', 'low'])
  })
})

describe('usage control', () => {
  test('max runs at most 10 minutes, then medium until a new prompt', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(10 * MIN - 1)
    await step($, 1)
    await clock.advance(1)
    await step($, 2)
    await answer($, 'max')
    await clock.advance(MIN)
    await step($, 3)
    expect(seen.efforts, 'answer.test.ts:max-cap').toEqual(['max', 'max', 'medium', 'medium'])
    expect(JSON.stringify(await command($)).includes('held at medium until a new prompt'), 'answer.test.ts:cap-shown').toBe(true)
    await prompt($)
    await step($, 0)
    expect(seen.efforts.at(-1), 'answer.test.ts:new-prompt').toBe('max')
  })

  // A max answer whose run used its 10 minutes is spent: a new prompt does not bring it back (a turn could start at the old
  // max, and its 60 s hold kept a new, lower answer waiting).
  test('R1: a max answer spent by its 10 minutes stays medium on the next prompt', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(10 * MIN)
    await step($, 1)
    await clock.advance(20 * MIN)
    await prompt($)
    await step($, 0)
    await step($, 1)
    expect(seen.efforts, 'answer.test.ts:R1').toEqual(['max', 'medium', 'medium', 'medium'])
  })

  test('R2: after the spent max, an answer of high applies at the next step', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(10 * MIN)
    await step($, 1)
    await clock.advance(20 * MIN)
    await prompt($)
    await step($, 0)
    await answer($, 'high')
    await step($, 1)
    expect(seen.efforts, 'answer.test.ts:R2').toEqual(['max', 'medium', 'medium', 'high'])
  })

  test('R3: a new max answer after the spent run starts a new run of at most 10 minutes', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(10 * MIN)
    await step($, 1)
    await clock.advance(20 * MIN)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(10 * MIN - 1)
    await step($, 1)
    await clock.advance(1)
    await step($, 2)
    expect(seen.efforts, 'answer.test.ts:R3').toEqual(['max', 'medium', 'max', 'max', 'medium'])
  })

  test('R4: a max run still inside its 10 minutes carries on over a new prompt, and ends at 10 minutes', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(5 * MIN)
    await prompt($)
    await step($, 0)
    await clock.advance(5 * MIN)
    await step($, 1)
    expect(seen.efforts, 'answer.test.ts:R4').toEqual(['max', 'max', 'medium'])
  })

  // The 10 minutes count wall time. A max turn followed by a long idle break is not a run the cap stopped: the carried
  // max starts a new run on the next prompt, with no detour to medium that would hold a new max answer for 60 s.
  test('R5: a max answer whose 10 minutes ran out while idle starts a new run on the next prompt', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(30 * MIN)
    await prompt($)
    await step($, 0)
    await clock.advance(10 * MIN - 1)
    await step($, 1)
    await clock.advance(1)
    await step($, 2)
    expect(seen.efforts, 'answer.test.ts:R5').toEqual(['max', 'max', 'max', 'medium'])
  })

  test('R6: after the idle break, max answered again applies at once', async ($, on) => {
    const clock = mock.clock(on)
    const seen = harness(on)
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(30 * MIN)
    await prompt($)
    await step($, 0)
    await answer($, 'max')
    await step($, 1)
    expect(seen.efforts, 'answer.test.ts:R6').toEqual(['max', 'max', 'max'])
  })

  test('R7: /adaptive-effort names the version the session loaded, from plugin.json', async ($, on) => {
    mock.clock(on)
    harness(on)
    await start($)
    const text = JSON.stringify(await command($))
    expect(text.includes(`version ${manifest.version} is on`), 'answer.test.ts:R7').toBe(true)
  })

  test('over the weekly budget an answered max stays max: the budget never lowers the effort', async ($, on) => {
    const clock = mock.clock(on)
    // A reset 96 h ahead at clock 0: 72 h gone. 77% used: allowed 23/96 per h, burn 77/72 per h, h = 0.22.
    const seen = harness(on, [{ kind: 'seven_day', percentUsed: 77, resetsAt: new Date(96 * 3600_000).toISOString() }])
    await start($)
    await prompt($)
    await answer($, 'max')
    await step($, 0)
    await clock.advance(121_000)
    await step($, 1)
    expect(seen.efforts, 'answer.test.ts:budget').toEqual(['max', 'max'])
  })

  test('/adaptive-effort shows the answer, the limits and the budget', async ($, on) => {
    const clock = mock.clock(on)
    harness(on)
    await start($)
    await prompt($)
    expect(JSON.stringify(await command($)).includes('has not answered EFFORT yet: medium'), 'answer.test.ts:shown-none').toBe(true)
    await answer($, 'xhigh')
    await clock.advance(2 * MIN)
    const text = JSON.stringify(await command($))
    expect(['Claude answered EFFORT=xhigh 2 min ago', 'stood 60 s', 'at most 10 minutes', 'no 7-day reading yet, no cap'].every(w => text.includes(w)), 'answer.test.ts:shown').toBe(true)
  })
})
