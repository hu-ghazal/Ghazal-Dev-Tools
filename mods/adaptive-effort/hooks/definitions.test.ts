import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_DEFINITIONS, DEFINED, STANDARD, countsIn, levelRules, ruleText, stepped, rulesLine, validDefinitions, weeklyBudget, withDefinition } from './classify'

// Each condition in a code and a general version, with the counts in force; the user's own texts, saved and read back.

const H = 3600_000
const week = (used: number) => [{ kind: 'seven_day', percentUsed: used, resetsAt: new Date(96 * H).toISOString() }]

describe('definitions', () => {
  test('R1 at the standard thresholds every condition has a code and a general version with the standard counts', () => {
    const r = levelRules(countsIn(STANDARD, false))
    expect(r, 'definitions.test.ts:R1').toEqual({
      max: [
        { code: 'changing a shared interface (API, schema, data format, config contract) that 2 or more places use', general: 'a decision that is hard to undo and that 2 or more other parts depend on' },
        { code: 'a bug whose cause is still unknown after 2 attempts', general: 'a problem whose cause is still unknown after 2 attempts' },
        { code: 'a change across 2 or more modules or services that must ship together', general: 'a change across 2 or more separate parts that must change together' },
      ],
      xhigh: [
        { code: 'the same test or check fails a 3rd time', general: 'the same problem comes back a 3rd time' },
        { code: 'a test or check that passed earlier fails again', general: 'something believed done turns out wrong' },
        { code: 'the code behaves differently from what reading it says', general: 'a result differs from what was expected' },
      ],
      high: [
        { code: '3 or more files that must stay consistent', general: '3 or more pieces that must agree with each other' },
        { code: '5 or more steps, each confirmed by running something (build, test, script)', general: '5 or more steps, each needing its own check' },
      ],
      medium: [
        { code: 'anything smaller: a clear next step, such as reading, renames, docs, config values, a fix confirmed on its first run', general: 'anything smaller: a clear next step where a mistake is easy to see and undo' },
      ],
    })
  })

  test('R2 Harder on max raises the max counts in both versions and leaves the other levels', () => {
    const r = levelRules(countsIn(stepped(STANDARD, 'max', 1), false))
    expect(r.max.map(x => [x.code, x.general].map(s => s.match(/\d+/)?.[0])), 'definitions.test.ts:R2').toEqual([['3', '3'], ['3', '3'], ['3', '3']])
    expect([r.xhigh[0].code, r.high[0].code], 'definitions.test.ts:R2-others').toEqual(['the same test or check fails a 3rd time', '3 or more files that must stay consistent'])
  })

  test('R3 over budget every count is one higher in both versions; the design decision keeps 2 places', () => {
    const r = levelRules(countsIn(STANDARD, true))
    const nums = (x: { code: string; general: string }) => [x.code, x.general].map(s => s.match(/\d+(st|nd|rd|th)?/)?.[0])
    expect([...r.max, ...r.xhigh.slice(0, 1), ...r.high].map(nums), 'definitions.test.ts:R3').toEqual([['2', '2'], ['3', '3'], ['3', '3'], ['4th', '4th'], ['4', '4'], ['6', '6']])
  })

  test('R4 the line beside the prompt carries both versions of every level, medium included', () => {
    const w = rulesLine(STANDARD, weeklyBudget(week(77), 0))
    const r = levelRules(countsIn(STANDARD, true))
    const missing = DEFINED.flatMap(l => r[l].map(ruleText).filter(t => !w.includes(t)))
    expect([missing, w.includes('medium: anything smaller')], 'definitions.test.ts:R4').toEqual([[], true])
    expect(ruleText(r.high[0]), 'definitions.test.ts:R4-form').toBe('4 or more files that must stay consistent (general: 4 or more pieces that must agree with each other)')
  })

  test('R8 saved definitions are read back only in the default shape, trimmed, with the default counts', () => {
    const own = withDefinition(DEFAULT_DEFINITIONS, 'high', 0, 'code', '  {n} or more source files changed together  ')
    expect(validDefinitions(JSON.parse(JSON.stringify(own)))?.high[0], 'definitions.test.ts:R8-own').toEqual({ count: 'files', code: '{n} or more source files changed together', general: '{n} or more pieces that must agree with each other' })
    const bad: unknown[] = [
      undefined, null, 'text', [],
      { ...DEFAULT_DEFINITIONS, max: undefined },
      { ...DEFAULT_DEFINITIONS, high: DEFAULT_DEFINITIONS.high.slice(0, 1) },
      { ...DEFAULT_DEFINITIONS, high: [{ code: '', general: 'x' }, DEFAULT_DEFINITIONS.high[1]] },
      { ...DEFAULT_DEFINITIONS, high: [{ code: 'x'.repeat(301), general: 'x' }, DEFAULT_DEFINITIONS.high[1]] },
      { ...DEFAULT_DEFINITIONS, high: [{ code: 3, general: 'x' }, DEFAULT_DEFINITIONS.high[1]] },
    ]
    expect(bad.map(validDefinitions), 'definitions.test.ts:R8-refused').toEqual(bad.map(() => undefined))
    // A count key in the saved file is ignored: the counts are the defaults'.
    const forged = JSON.parse(JSON.stringify(DEFAULT_DEFINITIONS))
    forged.high[0].count = 'steps'
    expect(validDefinitions(forged)?.high[0].count, 'definitions.test.ts:R8-count').toBe('files')
    // An empty or too long edit changes nothing.
    expect([withDefinition(DEFAULT_DEFINITIONS, 'max', 0, 'code', '   '), withDefinition(DEFAULT_DEFINITIONS, 'max', 0, 'code', 'x'.repeat(301))], 'definitions.test.ts:R8-edit').toEqual([DEFAULT_DEFINITIONS, DEFAULT_DEFINITIONS])
  })

  test('R9 a user text keeps a $ as written, and {n} and {nth} take the count', () => {
    const d = withDefinition(DEFAULT_DEFINITIONS, 'xhigh', 0, 'code', "costs $& or $' after {n} runs, the {nth} time")
    expect(levelRules(countsIn(STANDARD, false), d).xhigh[0].code, 'definitions.test.ts:R9').toBe("costs $& or $' after 3 runs, the 3rd time")
  })

  test('R10 own definitions are named in the line and used in it', () => {
    const own = withDefinition(DEFAULT_DEFINITIONS, 'medium', 0, 'general', 'a quick, clear task')
    const w = rulesLine(STANDARD, weeklyBudget(week(10), 0), undefined, own)
    expect([w.includes('definitions set by the user'), w.includes('(general: a quick, clear task)')], 'definitions.test.ts:R10').toEqual([true, true])
    expect(rulesLine(STANDARD, weeklyBudget(week(10), 0)).includes('definitions set by the user'), 'definitions.test.ts:R10-default').toBe(false)
  })

  test('L1 specific, in two versions: each code version names a code thing; no general version needs code words', () => {
    const r = levelRules(countsIn(STANDARD, false))
    const all = DEFINED.flatMap(l => r[l])
    const codeWord = /\b(code|API|schema|bug|modules?|services?|tests?|files?|build|script|renames|docs|config)\b/i
    expect(all.filter(x => !codeWord.test(x.code)).map(x => x.code), 'definitions.test.ts:L1-code').toEqual([])
    expect(all.filter(x => codeWord.test(x.general)).map(x => x.general), 'definitions.test.ts:L1-general').toEqual([])
    // Specific: every raised condition but the two observations of xhigh carries a count.
    const counted = (['max', 'xhigh', 'high'] as const).flatMap(l => r[l]).filter(x => /\d/.test(x.code) && /\d/.test(x.general)).length
    expect(counted, 'definitions.test.ts:L1-counts').toBe(6)
  })
})
