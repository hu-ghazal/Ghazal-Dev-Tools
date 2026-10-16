import { describe, expect, test } from 'claude-code/testing'

import { BACKGROUND, BARS, COLOR, EMPTY_CHART, MAX_SAVED, PLOT, SVG_H, SVG_W, chartAlt, chartSvg, chartTitle, chartView, kTokens, levelRows, merged, recordStep, restored, shares, stale } from './chart'
import type { ChartLog } from '../types'

// The pane's chart: output tokens per 15 minutes by effort in a frame of fixed size, kept 24 hours, light on the machine.

const MIN = 60_000
const HOUR = 60 * MIN
const label = (at: number) => `t${at / MIN}`
const step = (l: ChartLog, sent: any, at: number, tokens = 1000) => recordStep(l, sent, at, tokens)

describe('chart log', () => {
  test('each call counts by level with its output tokens, in its 15-minute bucket; no usage adds no tokens', () => {
    let l = EMPTY_CHART
    l = step(l, 'medium', 0, 700)
    l = step(l, 'medium', MIN, 0)
    l = step(l, 'max', 5 * MIN, 6_400)
    l = step(l, 'high', 15 * MIN, 1_500)
    expect(l.buckets.map(b => [b.at, b.n, b.tok]), 'chart.test.ts:buckets').toEqual([
      [0, [2, 0, 0, 1], [700, 0, 0, 6_400]],
      [15 * MIN, [0, 1, 0, 0], [0, 1_500, 0, 0]],
    ])
  })

  test('records older than 24 hours are deleted at every write: never more than 96 buckets', () => {
    let l = EMPTY_CHART
    for (let t = 0; t < 40 * HOUR; t += 5 * MIN) l = step(l, 'high', t)
    expect(l.buckets.length, 'chart.test.ts:96-buckets').toBe(96)
    expect(l.buckets[0].at > 40 * HOUR - 5 * MIN - 24 * HOUR, 'chart.test.ts:oldest-within-24h').toBe(true)
    expect(JSON.stringify(l).length < 12_000, 'chart.test.ts:small').toBe(true)
  })

  // Calls recorded without tokens would draw empty columns and pull the averages down.
  test('calls without tokens are neither averaged nor drawn: the chart starts at the first tokens', () => {
    const old = { buckets: [{ at: 0, n: [1, 20, 0, 0] }, { at: 15 * MIN, n: [18, 1, 0, 0] }, { at: 45 * MIN, n: [0, 20, 0, 0] }], last: 'high' } as any
    let l = step(old, 'high', 46 * MIN, 438)
    l = step(l, 'medium', 47 * MIN, 4_185)
    const v = chartView(l, 48 * MIN)
    expect([v.calls, v.tokens, v.bars.map(b => b.at / MIN)], 'chart.test.ts:old-bucket').toEqual([[1, 1, 0, 0], [4_185, 438, 0, 0], [45]])
    expect(levelRows(v), 'chart.test.ts:per-call').toEqual([
      { level: 'medium', calls: '1', each: '4.2k', share: '91%' },
      { level: 'high', calls: '1', each: '0.4k', share: '9%' },
    ])
    const mixed = { buckets: [{ at: 45 * MIN, n: [6, 20, 0, 0], tok: [4_185, 438, 0, 0] }], last: 'medium' } as any
    const w = chartView(step(mixed, 'medium', 46 * MIN, 900), 47 * MIN)
    expect([w.tokens[0], levelRows(w)[0].each, levelRows(w)[0].calls], 'chart.test.ts:mixed-bucket').toEqual([5_085, '0.9k', '1'])
  })

  // One row per level, each figure in its own column.
  test('one row per level: calls, output per call and share of output, each in its own column', () => {
    let l = step(EMPTY_CHART, 'medium', 0, 600)
    l = step(l, 'medium', 1_000, 800)
    l = step(l, 'high', 70_000, 1_800)
    const v = chartView(l, 70_000)
    expect(levelRows(v), 'chart.test.ts:rows').toEqual([
      { level: 'medium', calls: '2', each: '0.7k', share: '44%' },
      { level: 'high', calls: '1', each: '1.8k', share: '56%' },
    ])
    expect(shares(v), 'chart.test.ts:shares').toEqual([44, 56, 0, 0])
    expect(chartTitle(v), 'chart.test.ts:title').toBe('Output tokens per 15 minutes, by effort')
    expect(levelRows(chartView(step(EMPTY_CHART, 'high', 0, 0), 1)), 'chart.test.ts:no-usage').toEqual([])
    // All four levels each get their own row, and the values fit their columns.
    let all = EMPTY_CHART
    for (const [l, t] of [['medium', 700], ['high', 800], ['xhigh', 12_345], ['max', 2_500]] as const) all = step(all, l, 0, t)
    const rows = levelRows(chartView(all, 1))
    expect(rows.map(r => [r.level, r.each]), 'chart.test.ts:four-rows').toEqual([['medium', '0.7k'], ['high', '0.8k'], ['xhigh', '12k'], ['max', '2.5k']])
    expect(rows.every(r => r.calls.length < 9 && r.each.length < 10 && r.share.length < 10), 'chart.test.ts:fits-columns').toBe(true)
  })

  test('a saved chart reads back with only its last 24 hours; anything else is not a chart', () => {
    const now = 30 * HOUR
    const saved = { buckets: [{ at: 2 * HOUR, n: [1, 0, 0, 0], tok: [9, 0, 0, 0] }, { at: 20 * HOUR, n: [0, 1, 0, 0] }], last: 'high', maxRun: { start: 1 } }
    expect(restored(saved, now), 'chart.test.ts:restored').toEqual({ buckets: [{ at: 20 * HOUR, n: [0, 1, 0, 0], tok: [0, 0, 0, 0], nt: [0, 0, 0, 0], ct: [0, 0, 0, 0] }], last: 'high' })
    expect([restored('x', now), restored({ buckets: 3 }, now), restored(undefined, now)], 'chart.test.ts:not-a-chart').toEqual([undefined, undefined, undefined])
  })

  test('saved charts to delete: nothing in the last 24 hours, not a chart, or past the newest 30', () => {
    const now = 100 * HOUR
    const chartAt = (at: number) => ({ buckets: [{ at, n: [1, 0, 0, 0], tok: [1, 0, 0, 0] }] })
    const saved: [string, unknown][] = [['thresholds', { max: 0 }], ['chart:old', chartAt(now - 25 * HOUR)], ['chart:bad', 7]]
    for (let i = 0; i < MAX_SAVED + 2; i++) saved.push([`chart:s${i}`, chartAt(now - i * MIN)])
    expect(stale(saved, now, ['thresholds']).sort(), 'chart.test.ts:stale').toEqual(['chart:bad', 'chart:old', `chart:s${MAX_SAVED}`, `chart:s${MAX_SAVED + 1}`].sort())
    // Keys this build does not own are deleted; the thresholds stay.
    const old: [string, unknown][] = [['thresholds', {}], ['unknown-key', []], ['other:key', {}]]
    expect(stale(old, now, ['thresholds']), 'chart.test.ts:unowned').toEqual(['unknown-key', 'other:key'])
  })

  test('tokens are shown in thousands', () => {
    expect([0, 20, 650, 6_360, 9_960, 348_770, 1_250_000].map(kTokens), 'chart.test.ts:k').toEqual(['0', '<0.1k', '0.7k', '6.4k', '10k', '349k', '1.3M'])
  })

  test('the chart fits the last 24 hours: 15, 30 then 60-minute columns, never more than 24', () => {
    for (const [hours, minutes] of [[5, 15], [11, 30], [23, 60], [40, 60]] as const) {
      let l = EMPTY_CHART
      for (let h = 0; h <= hours; h++) l = step(l, 'medium', h * HOUR + 1)
      const v = chartView(l, hours * HOUR + 2)
      expect([v.minutes, v.bars.length <= BARS, v.bars[0].at > hours * HOUR - 24 * HOUR], `chart.test.ts:fit-${hours}h`).toEqual([minutes, true, true])
    }
  })

  test('columns run from the first call to now, empty ones included', () => {
    const v = chartView(step(step(EMPTY_CHART, 'medium', 0), 'high', 45 * MIN), 50 * MIN)
    expect([v.minutes, v.bars.map(b => b.at / MIN)], 'chart.test.ts:15-min').toEqual([15, [0, 15, 30, 45]])
  })
})

describe('chart drawing', () => {
  const rectsOf = (svg: string) =>
    [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="([^"]+)"\/>/g)].map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] }))
  const plotW = SVG_W - PLOT.left - PLOT.right
  const plotH = SVG_H - PLOT.top - PLOT.bottom

  test('a fixed frame: the tallest column fills the height; columns start in the left slot of 24, whatever the tokens', () => {
    for (const scale of [1, 1_000]) {
      let l = step(EMPTY_CHART, 'high', 1, 40_000 * scale)
      l = step(l, 'medium', 15 * MIN, 1_000 * scale)
      l = step(l, 'max', 15 * MIN + 1, 2_000 * scale)
      const svg = chartSvg(chartView(l, 16 * MIN), label)
      const rects = rectsOf(svg)
      expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}"`), `chart.test.ts:frame-${scale}`).toBe(true)
      expect(rects[0], `chart.test.ts:tallest-full-height-${scale}`).toEqual({ x: rects[0].x, y: PLOT.top, w: rects[0].w, h: plotH, fill: COLOR.high })
      // The first column in the first of 24 slots, the second in the next.
      const slot = plotW / BARS
      expect([Math.abs(rects[0].x - (PLOT.left + slot * 0.14)) < 0.2, Math.abs(rects[1].x - (PLOT.left + slot * 1.14)) < 0.2], `chart.test.ts:left-${scale}`).toEqual([true, true])
      expect([rects[1].fill, rects[2].fill, rects[1].y > rects[2].y], `chart.test.ts:stack-order-${scale}`).toEqual([COLOR.medium, COLOR.max, true])
    }
  })

  test('the y axis is labelled in thousands of tokens; Claude\'s dark background; the alt text says the same', () => {
    let l = step(EMPTY_CHART, 'high', 1, 40_000)
    l = step(l, 'medium', 15 * MIN, 1_000)
    const v = chartView(l, 16 * MIN)
    const svg = chartSvg(v, label)
    expect(svg.includes(`font-family="sans-serif"><rect width="${SVG_W}" height="${SVG_H}" rx="8" fill="${BACKGROUND}"/>`), 'chart.test.ts:background').toBe(true)
    expect(BACKGROUND, 'chart.test.ts:claude-dark').toBe('#262624')
    expect(['>0<', '>10k<', '>20k<', '>30k<', '>40k<'].every(t => svg.includes(t)), 'chart.test.ts:y-axis').toBe(true)
    expect(chartAlt(v, label), 'chart.test.ts:alt').toBe('Effort chart: output tokens per 15 minutes from t0 to t15; medium 1.0k, high 40k, extra high 0, max 0.')
  })

  test('24 columns stay well inside the Svg size bound', () => {
    let l = EMPTY_CHART
    for (let i = 0; i < 24; i++) for (const s of ['medium', 'high', 'xhigh', 'max']) l = step(l, s, i * 15 * MIN + 1)
    expect(chartSvg(chartView(l, 24 * 15 * MIN), label).length < 131_072, 'chart.test.ts:size').toBe(true)
  })

  // A plugin reload runs session.start with $.state intact and ahead of the last once-a-minute save: merge, never replace.
  test('a reload keeps the calls made since the last save; a restart, with nothing in memory, takes the save', () => {
    let saved = EMPTY_CHART
    for (let i = 0; i < 3; i++) saved = step(saved, 'medium', 60_000 * i, 500)
    let mem = saved
    for (let i = 3; i < 6; i++) mem = step(mem, 'high', 60_000 * i, 800)
    mem = step(mem, 'medium', 20 * 60_000, 600)
    const back = restored(JSON.parse(JSON.stringify(saved)), 21 * 60_000)!
    const r = merged(mem, back)
    expect(r.buckets.map(b => [b.at, b.n, b.ct]), 'chart.test.ts:reload').toEqual([
      [0, [3, 3, 0, 0], [1500, 2400, 0, 0]],
      [15 * 60_000, [1, 0, 0, 0], [600, 0, 0, 0]],
    ])
    expect(merged(EMPTY_CHART, back), 'chart.test.ts:restart').toEqual(back)
    // A bucket only in the save (an older quarter hour) is kept beside memory's own.
    const older = restored({ buckets: [{ at: -15 * 60_000, n: [2, 0, 0, 0], tok: [9, 0, 0, 0], nt: [2, 0, 0, 0], ct: [9, 0, 0, 0] }] }, 21 * 60_000)!
    expect(merged(mem, older).buckets.map(b => b.at), 'chart.test.ts:union').toEqual([-15 * 60_000, 0, 15 * 60_000])
  })
})
