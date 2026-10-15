import { describe, expect, mock, test } from 'claude-code/testing'

import { STANDARD, countsIn, levelRules, stepped } from './classify'


const OPUS = 'claude-opus-5-5'
const PANE = { component: 'Pane', requestId: 'adaptive-effort', props: { title: 'Thinking effort' }, viewport: { columns: 60, rows: 20 } } as any
const ANSWER = (effort: string) => `echo "EFFORT=${effort}"`

type Seen = { efforts: (string | undefined)[]; modelCalls: number; opens: any[]; panes: any[] }

function harness(on: any): Seen {
  const seen: Seen = { efforts: [], modelCalls: 0, opens: [], panes: [] }
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'adaptive-effort' } }))
  on('ui.open', ($: any, e: any) => { seen.opens.push(e); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: seen.panes }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined, rateLimits: [] } }))
  on('model.complete', () => { seen.modelCalls += 1; return { value: { isAnswered: true, text: '3', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } })
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('turn.step', async function* ($: any, e: any) {
    seen.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return seen
}

async function step($: any, index: number) {
  const s = $.turn.step({ turnId: 't1', index, model: OPUS, effort: 'medium', messageCount: 1 })
  for await (const _ of s) void _
}
const start = ($: any) => $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
const command = ($: any, args: string) =>
  $.command.run({ command: 'adaptive-effort', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

describe('controls', () => {
  test('Harder on max raises only the max counts and makes a design decision need that many systems', () => {
    const r = levelRules(countsIn(stepped(STANDARD, 'max', 1), false))
    expect(r.max, 'pane.test.ts:max-harder').toEqual([
      'a design or architecture decision with real trade-offs that spans 3 or more systems',
      'a failure still unexplained after 3 attempts',
      'a change across 3 or more systems where a wrong fix is likely',
    ])
    expect([r.xhigh[0], r.high[0]], 'pane.test.ts:others-unchanged').toEqual(['the same kind of failure a 3rd time', '3 or more files or components that must stay consistent'])
    expect(levelRules(countsIn(STANDARD, true)).max[0], 'pane.test.ts:budget-keeps-design-max').toBe('a design or architecture decision with real trade-offs')
    expect(stepped(stepped(stepped(stepped(STANDARD, 'max', 1), 'max', 1), 'max', 1), 'max', 1).max, 'pane.test.ts:step-max').toBe(3)
  })

  test('the pane: one block per level, each condition on its own line, Easier and Harder per level; Save and Reset', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const seen = harness(on)
    await start($)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface, ...PANE })
      for (const l of ['max', 'xhigh', 'high']) {
        expect([await ui.find({ type: 'Button', key: `${l}-easier` }), await ui.find({ type: 'Button', key: `${l}-harder` })].every(x => x !== undefined), `pane.test.ts:${surface}:${l}-buttons`).toBe(true)
      }
      expect(await ui.find({ type: 'Text', text: /^  • a failure still unexplained after 2 attempts$/ }), `pane.test.ts:${surface}:max-line`).toBeDefined()
      expect([await ui.find({ type: 'Text', text: /sooner|later/i }), await ui.find({ type: 'Svg' }), await ui.find({ type: 'Client' })], `pane.test.ts:${surface}:no-timing-no-graphic`).toEqual([undefined, undefined, undefined])
      await ui.press({ key: 'max-harder' })
      expect(await ui.find({ type: 'Text', text: /^  • a failure still unexplained after 3 attempts$/ }), `pane.test.ts:${surface}:max-harder`).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\(current settings not saved\)/ }), `pane.test.ts:${surface}:unsaved`).toBeDefined()
      await ui.press({ key: 'save' })
      expect(await ui.find({ type: 'Text', text: /^Default for new sessions: max harder \+1, xhigh standard, high standard$/ }), `pane.test.ts:${surface}:saved`).toBeDefined()
      await ui.press({ key: 'reset' })
      expect(await ui.find({ type: 'Text', text: /^Default for new sessions: standard$/ }), `pane.test.ts:${surface}:reset`).toBeDefined()
      await ui.unmount()
    }
    // Auto stays: the thresholds change what Claude reads, never the effort sent; Claude's answer decides.
    await command($, 'max harder')
    await command($, 'max harder')
    await $.turn.start({ turnId: 't1', text: 'next' })
    await step($, 0)
    await $.tool.call({ tool: 'Bash', command: ANSWER('max') })
    await clock.advance(60_000)
    await step($, 1)
    expect(seen.efforts, 'pane.test.ts:auto-follows-answer').toEqual(['medium', 'max'])
    expect(seen.modelCalls, 'pane.test.ts:no-model-call').toBe(0)
  })

  test('/adaptive-effort pane raises the pane with focus and says whether it is shown or behind another pane', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const seen = harness(on)
    await start($)
    seen.panes = [{ id: 'adaptive-effort', title: 'Thinking effort', isShown: true, isFocused: true, isPlaced: true }]
    const shown: any = await command($, 'pane')
    expect(seen.opens.at(-1)?.focus, 'pane.test.ts:pane-focus').toBe(true)
    expect(shown?.text, 'pane.test.ts:pane-shown').toBe('Thinking effort pane shown.')
    seen.panes = [{ id: 'adaptive-effort', title: 'Thinking effort', isShown: false, isFocused: false, isPlaced: true }]
    const behind: any = await command($, 'pane')
    expect(behind?.text, 'pane.test.ts:pane-behind').toBe('Thinking effort pane is open behind another pane: click its "Thinking effort" tab.')
  })

  test('saved thresholds are the default the next session starts from, and Claude reads them beside the prompt', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    harness(on)
    on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
    await start($)
    await command($, 'max harder')
    await command($, 'save')
    await command($, 'max easier')
    // A new session: the module's session values start from the store.
    await start($)
    const sent: any = await $.prompt.submit({ text: 'next' } as any)
    const line = (sent?.context ?? []).join('\n')
    expect(line.includes('thresholds set by the user: max harder +1, xhigh standard, high standard'), 'pane.test.ts:saved-default').toBe(true)
    expect(line.includes('a failure still unexplained after 3 attempts'), 'pane.test.ts:saved-counts').toBe(true)
  })
})
