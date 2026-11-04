import { describe, expect, mock, test } from 'claude-code/testing'

import { WORK_TOOLS, lowLapsed, MAX_HOLD_MS } from './classify'


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
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { output_tokens: 10 } }
  })
  return efforts
}

async function step($: any, index: number) {
  const s = $.turn.step({ turnId: 't1', index, model: OPUS, effort: 'medium', messageCount: 1 })
  for await (const _ of s) void _
}
const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
const prompt = ($: any) => $.turn.start({ turnId: 't1', text: 'how is it going?' })
const answer = ($: any, effort: string) => $.tool.call({ tool: 'Bash', command: ANSWER(effort) })

describe('low ends when the work starts', () => {
  test('W1 the first edit in the turn lifts low to medium; reads and commands before it keep low', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    await $.tool.call({ tool: 'Read', file_path: '/work/project/x.md' })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await step($, 1)
    await clock.advance(5_000)
    await $.tool.call({ tool: 'Edit', file_path: '/work/project/x.md', old_string: 'a', new_string: 'b' })
    await step($, 2)
    expect(efforts, 'work-ends-low.test.ts:W1').toEqual(['low', 'low', 'medium'])
  })

  test('W2 every tool that does the work lifts low: edits, writes, notebooks, subagents and workflows', () => {
    expect(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Agent', 'Task', 'Workflow'].every(t => WORK_TOOLS.has(t)), 'work-ends-low.test.ts:W2-work').toBe(true)
    expect(['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'].some(t => WORK_TOOLS.has(t)), 'work-ends-low.test.ts:W2-reads').toBe(false)
  })

  test('W3 low returns to medium 10 minutes after it was answered, inside one turn with no edit', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    await clock.advance(9 * MIN)
    await step($, 1)
    await clock.advance(MIN + 1_000)
    await step($, 2)
    expect([efforts, lowLapsed(-1, 0, MAX_HOLD_MS), lowLapsed(-1, 0, MAX_HOLD_MS - 1), lowLapsed(0, 0, MAX_HOLD_MS * 2)], 'work-ends-low.test.ts:W3')
      .toEqual([['low', 'low', 'medium'], true, false, false])
  })

  test('W5 a new prompt keeps low: the next prompt may be another simple question; Claude answers again there', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    await clock.advance(2 * MIN)
    await prompt($)
    await step($, 0)
    await answer($, 'medium')
    await step($, 1)
    expect(efforts, 'work-ends-low.test.ts:W5').toEqual(['low', 'low', 'medium'])
  })

  test('W4 after the lift Claude can still answer a higher level, and a later low answer is low again', async ($, on) => {
    const clock = mock.clock(on)
    const efforts = harness(on)
    await start($)
    await prompt($)
    await answer($, 'low')
    await step($, 0)
    await $.tool.call({ tool: 'Write', file_path: '/work/project/y.md', content: 'z' })
    await step($, 1)
    await clock.advance(61_000)
    await answer($, 'high')
    await step($, 2)
    await clock.advance(61_000)
    await answer($, 'low')
    await step($, 3)
    expect(efforts, 'work-ends-low.test.ts:W4').toEqual(['low', 'medium', 'high', 'low'])
  })
})
