import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_DEFINITIONS, STANDARD, countsIn, levelRules, stepped } from './classify'


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
    // Step i spends (i + 1) thousand output tokens.
    const usage = { input_tokens: 2, output_tokens: 1000 * (e.index + 1), cache_creation_input_tokens: 0, cache_read_input_tokens: 200_000, model: OPUS }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
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
    expect(r.max.map(x => x.code), 'pane.test.ts:max-harder').toEqual([
      'changing a shared interface (API, schema, data format, config contract) that 3 or more places use',
      'a bug whose cause is still unknown after 3 attempts',
      'a change across 3 or more modules or services that must ship together',
    ])
    expect([r.xhigh[0].code, r.high[0].code], 'pane.test.ts:others-unchanged').toEqual(['the same test or check fails a 3rd time', '3 or more files that must stay consistent'])
    expect(levelRules(countsIn(STANDARD, true)).max[0].code, 'pane.test.ts:budget-keeps-design-max').toBe('changing a shared interface (API, schema, data format, config contract) that 2 or more places use')
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
      // The controls print no conditions; Settings edits them.
      expect(await ui.find({ type: 'Text', text: /^• / }), `pane.test.ts:${surface}:no-conditions`).toBe(undefined)
      expect(await ui.find({ type: 'Button', key: 'settings' }), `pane.test.ts:${surface}:settings`).toBeDefined()
      // The pane says what a press changes: the conditions, and the effort follows Claude's next answer.
      expect(await ui.find({ type: 'Text', text: /^Claude picks a level whose conditions match the work; where several match, it chooses by the work and the usage\. Easier or Harder changes the conditions; the effort follows Claude's next answer\.$/ }), `pane.test.ts:${surface}:explain`).toBeDefined()
      expect([await ui.find({ type: 'Text', text: /sooner|later/i }), await ui.find({ type: 'Svg' }), await ui.find({ type: 'Client' })], `pane.test.ts:${surface}:no-timing-no-graphic`).toEqual([undefined, undefined, undefined])
      // Each card: a four-word definition, the setting only when changed; no "standard" and no "the rest".
      for (const line of ['Hard-to-undo or unexplained problems', 'Repeated or surprising failures', 'Many parts, many checks', 'Clear steps, easily undone']) {
        expect(await ui.find({ type: 'Text', text: line }), `pane.test.ts:${surface}:summary:${line}`).toBeDefined()
      }
      expect([await ui.find({ type: 'Text', text: /standard|^the rest$/ }), await ui.find({ type: 'Button', key: 'reset' })].map(x => x?.text ?? x?.props?.label), `pane.test.ts:${surface}:default-words`).toEqual([undefined, 'Reset to default'])
      await ui.press({ key: 'max-harder' })
      expect(await ui.find({ type: 'Text', text: /^Hard-to-undo or unexplained problems · harder \+1$/ }), `pane.test.ts:${surface}:max-harder`).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\(current settings not saved\)/ }), `pane.test.ts:${surface}:unsaved`).toBeDefined()
      await ui.press({ key: 'save' })
      expect(await ui.find({ type: 'Text', text: /^Default for new sessions: max harder \+1, xhigh default, high default$/ }), `pane.test.ts:${surface}:saved`).toBeDefined()
      await ui.press({ key: 'reset' })
      expect(await ui.find({ type: 'Text', text: /^Default for new sessions: the defaults$/ }), `pane.test.ts:${surface}:reset`).toBeDefined()
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

  test('the pane ends with the chart: a table of the levels used and drawn columns, updating as steps happen', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    harness(on)
    await start($)
    const open: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    expect(await open.find({ type: 'Text', text: /^No model calls yet since this build loaded\.$/ }), 'pane.test.ts:chart-empty').toBeDefined()
    await $.turn.start({ turnId: 't1', text: 'next' })
    await step($, 0)
    await $.tool.call({ tool: 'Bash', command: ANSWER('max') })
    await clock.advance(60_000)
    await step($, 1)
    await step($, 2)
    // The pane already open draws the steps without being opened again.
    const live: any = await open.find({ type: 'Svg' })
    expect(typeof live?.props?.source === 'string' && (live.props.source as string).includes('#042C53'), 'pane.test.ts:chart-live').toBe(true)
    await open.unmount()
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface, ...PANE })
      expect(await ui.find({ type: 'Text', text: /^Output tokens per 15 minutes, by effort$/ }), `pane.test.ts:${surface}:chart-title`).toBeDefined()
      // One medium call of 1k and two max calls of 2k and 3k output tokens.
      // One row per level used: name, calls, output per call, share of output.
      for (const [key, text] of [['row-level', 'EffortCallsPer callOf output'], ['row-medium', '■ Medium11.0k17%'], ['row-max', '■ Max22.5k83%']]) {
        expect((await ui.find({ key: key.replace('level', 'Effort') }))?.text, `pane.test.ts:${surface}:${key}`).toBe(text)
      }
      // Only the levels used are listed; no line about levels not used.
      expect(await ui.find({ type: 'Text', text: /max run/i }), `pane.test.ts:${surface}:no-max-run`).toBeUndefined()
      const svg: any = await ui.find({ type: 'Svg' })
      if (surface === 'terminal') {
        // No Svg on the terminal: 1k medium and 5k max tokens, the column 20 marks wide, 3 medium and 17 max.
        expect([svg, await ui.find({ type: 'Text', text: /^[0-9]{2}:[0-9]{2} ░{3}█{17} +6\.0k$/ }) !== undefined], `pane.test.ts:${surface}:rows`).toEqual([undefined, true])
      } else {
        expect(/^Effort chart: output tokens per 15 minutes from [0-9]{2}:[0-9]{2} to [0-9]{2}:[0-9]{2}; medium 1\.0k, high 0, extra high 0, max 5\.0k\.$/.test(svg?.props?.alt ?? ''), `pane.test.ts:${surface}:svg`).toBe(true)
        // A fixed frame: the drawing never grows with the pane or the data.
        expect([svg?.props?.width, svg?.props?.height], `pane.test.ts:${surface}:fixed-frame`).toEqual([340, 190])
      }
      expect(await ui.find({ type: 'Client' }), `pane.test.ts:${surface}:no-client`).toBeUndefined()
      expect([await ui.find({ text: /not followed|answers from claude/i }), await ui.find({ type: 'Text', text: /^Effort changes$/ })], `pane.test.ts:${surface}:no-endless-counts`).toEqual([undefined, undefined])
      await ui.unmount()
    }
  })

  test('after an app restart the chart comes back from the store; saved charts older than 24 hours are deleted', async ($, on) => {
    const now = 100 * 3_600_000
    const clock = mock.clock(on, { now })
    // The plugin's store as the app keeps it across a restart, in a map the test can read.
    const mem = new Map<string, unknown>([
      ['chart:S1', { buckets: [{ at: now, n: [2, 0, 0, 0], tok: [3_000, 0, 0, 0], nt: [2, 0, 0, 0], ct: [3_000, 0, 0, 0] }], last: 'medium' }],
      ['chart:OLD', { buckets: [{ at: now - 30 * 3_600_000, n: [1, 0, 0, 0], tok: [1_000, 0, 0, 0] }] }],
      ['chart:BAD', 'not a chart'],
      ['thresholds', { max: 1, xhigh: 0, high: 0 }],
      ['unknown-key', [1]],
    ])
    on('store.get', ($: any, e: any) => ({ value: mem.get(e.key) }))
    on('store.set', ($: any, e: any) => { mem.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
    on('store.delete', ($: any, e: any) => { mem.delete(e.key); return { value: undefined } })
    on('store.keys', () => ({ value: [...mem.keys()] }))
    const $store = { get: async (k: string) => mem.get(k) }
    harness(on)
    on('session.id', () => ({ value: 'S1' }))
    await start($)
    expect([...mem.keys()].sort(), 'pane.test.ts:old-deleted').toEqual(['chart:S1', 'thresholds'])
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    expect((await ui.find({ key: 'row-medium' }))?.text, 'pane.test.ts:restored').toBe('■ Medium21.5k100%')
    await ui.unmount()
    // Saved at most once a minute: the first call saves, one 10 s later does not, one a minute later does.
    await $.turn.start({ turnId: 't1', text: 'next' })
    await step($, 0)
    const first = JSON.stringify(await $store.get('chart:S1'))
    await clock.advance(10_000)
    await step($, 1)
    expect(JSON.stringify(await $store.get('chart:S1')), 'pane.test.ts:not-every-call').toBe(first)
    await clock.advance(60_000)
    await step($, 2)
    const saved: any = await $store.get('chart:S1')
    const medium = saved.buckets.reduce((a: number, b: any) => a + b.tok[0], 0)
    expect(medium, 'pane.test.ts:saved-a-minute-later').toBe(3_000 + 1_000 + 2_000 + 3_000)
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
    expect(line.includes('thresholds set by the user: max harder +1, xhigh default, high default'), 'pane.test.ts:saved-default').toBe(true)
    expect(line.includes('a bug whose cause is still unknown after 3 attempts'), 'pane.test.ts:saved-counts').toBe(true)
  })

  test('Settings shows each definition in a field; Enter saves it for Claude and new sessions; Reset brings back the defaults', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    harness(on)
    on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface, ...PANE })
      expect(await ui.find({ type: 'Input', key: 'def-high-0-code' }), `pane.test.ts:${surface}:settings-closed`).toBe(undefined)
      await ui.press({ key: 'settings' })
      expect((await ui.find({ type: 'Input', key: 'def-high-0-code' }))?.props?.value, `pane.test.ts:${surface}:settings-field`).toBe('3 or more files that must stay consistent')
      expect([await ui.find({ type: 'Button', key: 'max-harder' }), await ui.find({ type: 'Input', key: 'def-medium-0-general' })].map(x => x !== undefined), `pane.test.ts:${surface}:settings-view`).toEqual([false, true])
      await ui.input({ key: 'def-high-0-code', text: '5 or more source files changed together', kind: 'submit' })
      await ui.input({ key: 'def-high-0-general', text: '5 or more parts changed together', kind: 'submit' })
      const sent: any = await $.prompt.submit({ text: 'next' } as any)
      const line = (sent?.context ?? []).join('\n')
      expect([line.includes('5 or more source files changed together (general: 5 or more parts changed together)'), line.includes('definitions set by the user')], `pane.test.ts:${surface}:settings-claude`).toEqual([true, true])
      await ui.press({ key: 'definitions-reset' })
      const back: any = await $.prompt.submit({ text: 'again' } as any)
      expect((back?.context ?? []).join('\n').includes('definitions set by the user'), `pane.test.ts:${surface}:settings-reset`).toBe(false)
      await ui.press({ key: 'settings' })
      expect(await ui.find({ type: 'Button', key: 'max-harder' }), `pane.test.ts:${surface}:settings-done`).toBeDefined()
      await ui.unmount()
    }
  })

  test('a new session starts from the saved definitions, and the next start keeps them', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    harness(on)
    on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
    await start($)
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    await ui.press({ key: 'settings' })
    await ui.input({ key: 'def-medium-0-general', text: 'a quick, clear task', kind: 'submit' })
    await ui.unmount()
    for (const n of [1, 2]) {
      await start($)
      const sent: any = await $.prompt.submit({ text: `next ${n}` } as any)
      expect((sent?.context ?? []).join('\n').includes('(general: a quick, clear task)'), `pane.test.ts:saved-definitions-${n}`).toBe(true)
    }
  })
  // Operator 2026-10-16: "how to turn on and off effort? is it explained in github?!!!" then "yes, update clearly".
  test('Turn off and Turn on: the button, the choice kept for new sessions, and the command', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    harness(on)
    on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
    await start($)
    const label = async (ui: any) => (await ui.find({ type: 'Button', key: 'power' }))?.props?.label
    const lines = async (text: string) => (((await $.prompt.submit({ text } as any)) as any)?.context ?? []).join('\n').includes('EFFORT')
    const ui: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    expect([await label(ui), await lines('on')], 'pane.test.ts:on-off:on').toEqual(['Turn off', true])
    await ui.press({ key: 'power' })
    expect([await label(ui), (await ui.find({ type: 'Text', text: /^ Off $/ })) !== undefined, (await ui.find({ type: 'Text', text: /^Off: Claude Code keeps its own effort/ })) !== undefined], 'pane.test.ts:on-off:off').toEqual(['Turn on', true, true])
    await ui.unmount()
    expect(await lines('while off'), 'pane.test.ts:on-off:nothing-beside-prompt').toBe(false)
    await start($)
    const next: any = await $.ui.mount({ plugin: 'adaptive-effort', surface: 'desktop', ...PANE })
    expect([await label(next), await lines('new session')], 'pane.test.ts:on-off:kept').toEqual(['Turn on', false])
    await next.unmount()
    await command($, 'on')
    await start($)
    expect(await lines('back on'), 'pane.test.ts:on-off:command-on-kept').toBe(true)
  })
})
