// adaptive-effort · Copyright (c) 2026 hu-ghazal · https://github.com/hu-ghazal/Ghazal-Dev-Tools
// Shared under the PolyForm Noncommercial License 1.0.0 (see LICENSE). You are welcome to use, study and adapt it for
// noncommercial purposes; please keep this notice and the licence with any copy, and credit the original.
// Commercial use needs a separate licence.

import type { ChartBucket, ChartLog, EffortLevel } from '../types'

// The pane's chart: per 15 minutes, the output tokens (thinking included) each effort level spent, stacked in one
// column, in a frame of fixed size whose tallest column fills the height. Output tokens are what the effort changes;
// cache reads are the context, the same at every level, so they are not counted. Pure: the hooks module records each
// step and its tokens and draws what chartView() returns.

export const ORDER: readonly EffortLevel[] = ['medium', 'high', 'xhigh', 'max']
/** The chart's colours, lightest for medium. */
export const COLOR: Record<EffortLevel, string> = { medium: '#B5D4F4', high: '#378ADD', xhigh: '#185FA5', max: '#042C53' }
export const TITLE: Record<EffortLevel, string> = { medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
// Calls are kept per 15 minutes; buckets older than KEEP_MS are deleted, so a chart holds at most 96 buckets.
export const BUCKET_MS = 15 * 60_000
/** Buckets older than this are deleted at every write. */
export const KEEP_MS = 24 * 3_600_000
/** The fixed number of column slots, filled from the left. */
export const BARS = 24
/** Column widths in minutes: 15, then 30 past 6 hours, then 60 past 12, so the span always fits BARS columns. */
export const WIDTHS = [15, 30, 60] as const
export const EMPTY_CHART: ChartLog = { buckets: [] }

type Four = [number, number, number, number]
const zero = (): Four => [0, 0, 0, 0]
const total = (x: Four) => x[0] + x[1] + x[2] + x[3]
const copy = (b: ChartBucket): ChartBucket => ({ at: b.at, n: [...b.n] as Four, tok: [...(b.tok ?? zero())] as Four, nt: [...(b.nt ?? zero())] as Four, ct: [...(b.ct ?? zero())] as Four })

/** One main-loop model call sent at `sent` at `now`, recorded once its response is in: one write per call, to keep
 *  the mod light. Counted by level with its output tokens, and as a call with usage when the response carried any;
 *  buckets older than 24 hours go. */
export function recordStep(log: ChartLog, sent: EffortLevel, now: number, tokens = 0): ChartLog {
  const start = Math.floor(now / BUCKET_MS) * BUCKET_MS
  const kept = log.buckets.filter(x => x.at > now - KEEP_MS)
  const last = kept.at(-1)
  const b = last?.at === start ? copy(last) : { at: start, n: zero(), tok: zero(), nt: zero(), ct: zero() }
  const buckets = last?.at === start ? [...kept.slice(0, -1), b] : [...kept, b]
  const i = ORDER.indexOf(sent)
  b.n[i] += 1
  if (tokens > 0) {
    b.tok![i] += Math.round(tokens)
    b.nt![i] += 1
    b.ct![i] += Math.round(tokens)
  }
  return { buckets, last: sent }
}

// Kept across an app restart: each session's chart is saved
// in the plugin's own store under `chart:<session id>`, at most once a minute and at the session's end, and read back
// when the session starts again. At every session start the saved charts with nothing in the last 24 hours, and all
// but the newest MAX_SAVED, are deleted, so the store stays small (a chart is at most 96 buckets, a few KB).
export const STORE_CHART = 'chart:'
export const SAVE_EVERY_MS = 60_000
export const MAX_SAVED = 30

const isFour = (x: unknown): x is Four => Array.isArray(x) && x.length === 4 && x.every(n => typeof n === 'number' && n >= 0)

/** A saved chart read back: only its buckets of the last 24 hours; undefined when it is not a chart. */
export function restored(x: unknown, now: number): ChartLog | undefined {
  const l = x as ChartLog | undefined
  if (typeof l !== 'object' || l === null || !Array.isArray(l.buckets)) return undefined
  const buckets = l.buckets
    .filter(b => typeof b?.at === 'number' && isFour(b.n) && b.at > now - KEEP_MS)
    .map(b => ({ at: b.at, n: [...b.n] as Four, tok: isFour(b.tok) ? ([...b.tok] as Four) : zero(), nt: isFour(b.nt) ? ([...b.nt] as Four) : zero(), ct: isFour(b.ct) ? ([...b.ct] as Four) : zero() }))
  const last = ORDER.includes(l.last as EffortLevel) ? l.last : undefined
  return { buckets, last }
}

/** The chart after session.start: the one in memory merged with the one saved. A /reload-plugins runs session.start
 *  with memory intact and ahead of the last save; an app restart runs it with memory empty. Per quarter hour the bucket
 *  with more calls wins (memory, on a tie), so neither loses what the other has. */
export function merged(mem: ChartLog, saved: ChartLog): ChartLog {
  const sum = (b: ChartBucket) => b.n[0] + b.n[1] + b.n[2] + b.n[3]
  const by = new Map<number, ChartBucket>()
  for (const b of saved.buckets) by.set(b.at, b)
  for (const b of mem.buckets) {
    const o = by.get(b.at)
    if (o === undefined || sum(b) >= sum(o)) by.set(b.at, b)
  }
  const buckets = [...by.values()].sort((a, b) => a.at - b.at).map(copy)
  const ahead = mem.buckets.length > 0
  return { buckets, last: ahead ? mem.last : saved.last }
}

/** The store keys to delete: a key this build does not own, and the saved charts that are not a chart, have nothing in
 *  the last 24 hours, or are older than the newest MAX_SAVED. `owned` names the other keys this build keeps. */
export function stale(saved: [key: string, value: unknown][], now: number, owned: readonly string[] = []): string[] {
  const unowned = saved.filter(([k]) => !k.startsWith(STORE_CHART) && !owned.includes(k)).map(([k]) => k)
  const newest = saved
    .filter(([k]) => k.startsWith(STORE_CHART))
    .map(([k, v]) => [k, restored(v, now)?.buckets.at(-1)?.at] as const)
  const live = newest.filter(([, at]) => at !== undefined).sort((a, b) => b[1]! - a[1]!)
  return [...unowned, ...newest.filter(([, at]) => at === undefined).map(([k]) => k), ...live.slice(MAX_SAVED).map(([k]) => k)]
}

export type ChartView = {
  /** Minutes per column. */
  minutes: number
  /** Per column, oldest first from the left slot: its start and output tokens at medium, high, xhigh and max. */
  bars: { at: number; tok: Four }[]
  /** Calls that reported usage, and their output tokens, at each level over the columns shown. */
  calls: Four
  tokens: Four
  /** The output tokens of the counted calls, what output per call divides. */
  callTokens: Four
}

/** The columns from the first bucket with output tokens to now: 15 minutes wide while that fits BARS columns, else the
 *  next width in WIDTHS. Calls of older builds that recorded no tokens are not drawn and not averaged. */
export function chartView(log: ChartLog, now: number): ChartView {
  const kept = log.buckets.filter(x => x.at > now - KEEP_MS && total(x.tok ?? zero()) > 0)
  const span = kept.length === 0 ? 0 : now - kept[0].at
  const minutes = WIDTHS.find(w => span < w * 60_000 * BARS) ?? 60
  const size = minutes * 60_000
  const bars: ChartView['bars'] = []
  const calls = zero()
  const tokens = zero()
  const callTokens = zero()
  if (kept.length > 0) {
    for (let at = Math.floor(kept[0].at / size) * size; at <= now; at += size) {
      const col = { at, tok: zero() }
      for (const x of kept) {
        if (x.at < at || x.at >= at + size) continue
        for (let i = 0; i < 4; i++) col.tok[i] += x.tok![i]
      }
      bars.push(col)
    }
  }
  const shown = bars.slice(-BARS)
  for (const x of kept) {
    if (x.at < (shown[0]?.at ?? Infinity)) continue
    for (let i = 0; i < 4; i++) {
      calls[i] += x.nt?.[i] ?? 0
      tokens[i] += x.tok![i]
      // Output per call divides the tokens of the calls that reported usage by their number.
      callTokens[i] += x.ct?.[i] ?? 0
    }
  }
  return { minutes, bars: shown, calls, tokens, callTokens }
}

export type SessionUse = { calls: number; tokens: Four }
/** This session's calls with usage and their output tokens in the last hour (the 15-minute buckets that start in it),
 *  by level: what Claude weighs before it answers EFFORT. */
export function lastHourUse(log: ChartLog, now: number): SessionUse {
  const use: SessionUse = { calls: 0, tokens: zero() }
  for (const x of log.buckets) {
    if (x.at <= now - 3_600_000) continue
    use.calls += total(x.nt ?? zero())
    for (let i = 0; i < 4; i++) use.tokens[i] += x.tok?.[i] ?? 0
  }
  return use
}

/** Tokens in thousands: `0.7k`, `12k`, `1.2M`. */
export function kTokens(t: number): string {
  if (t >= 999_500) return `${(t / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (t >= 9_950) return `${Math.round(t / 1000)}k`
  if (t === 0) return '0'
  // Never "0.0k" for a few tokens.
  if (t < 50) return '<0.1k'
  return `${(t / 1000).toFixed(1)}k`
}

/** Each level's share of the output tokens shown, in whole percent (the legend). */
export function shares(v: ChartView): Four {
  const all = total(v.tokens)
  return v.tokens.map(t => (all === 0 ? 0 : Math.round((t * 100) / all))) as Four
}

/** The table under the chart title, one row per level with output tokens: its calls, the average output of one
 *  call, and its share of all output, each in its own column. A level whose calls reported no usage reads "-". */
export type LevelRow = { level: EffortLevel; calls: string; each: string; share: string }
export function levelRows(v: ChartView): LevelRow[] {
  const s = shares(v)
  return ORDER.flatMap((l, i) =>
    v.tokens[i] > 0
      ? [{ level: l, calls: String(v.calls[i]), each: v.calls[i] > 0 ? kTokens(v.callTokens[i] / v.calls[i]) : '-', share: `${s[i]}%` }]
      : [],
  )
}
export const TABLE_HEAD: Omit<LevelRow, 'level'> & { level: string } = { level: 'Effort', calls: 'Calls', each: 'Per call', share: 'Of output' }

/** The chart's title; the table under it lists only the levels used. */
export const chartTitle = (v: ChartView) => `Output tokens per ${v.minutes} minutes, by effort`

/** The frame is fixed: the columns always fill its width and the tallest column fills its height. */
export const SVG_W = 340
export const SVG_H = 190
export const PLOT = { left: 34, right: 4, top: 8, bottom: 22 }
const AXIS = '#898781'
/** Claude's dark background, under the chart by default. */
export const BACKGROUND = '#262624'
const r1 = (x: number) => Math.round(x * 10) / 10

/** Stacked columns of output tokens, medium at the bottom; gridlines at a quarter, half, three quarters and all of
 *  the tallest column, labelled in thousands. */
export function chartSvg(v: ChartView, label: (at: number) => string): string {
  const plotW = SVG_W - PLOT.left - PLOT.right
  const plotH = SVG_H - PLOT.top - PLOT.bottom
  const peak = Math.max(1, ...v.bars.map(b => total(b.tok)))
  const y = (t: number) => r1(PLOT.top + plotH - (t / peak) * plotH)
  // BARS fixed slots; the first column in the left slot, later ones to its right.
  const slot = plotW / BARS
  const bw = r1(slot * 0.72)
  const every = 4
  const parts: string[] = [`<rect width="${SVG_W}" height="${SVG_H}" rx="8" fill="${BACKGROUND}"/>`]
  for (let i = 0; i <= 4; i++) {
    const at = y((peak * i) / 4)
    parts.push(`<line x1="${PLOT.left}" x2="${SVG_W - PLOT.right}" y1="${at}" y2="${at}" stroke="${AXIS}" stroke-opacity="0.3"/>`)
    parts.push(`<text x="${PLOT.left - 4}" y="${r1(at + 3.5)}" text-anchor="end" font-size="10" fill="${AXIS}">${kTokens((peak * i) / 4)}</text>`)
  }
  v.bars.forEach((b, i) => {
    const x = r1(PLOT.left + slot * i + (slot - bw) / 2)
    let below = 0
    ORDER.forEach((l, j) => {
      const t = b.tok[j]
      if (t === 0) return
      parts.push(`<rect x="${x}" y="${y(below + t)}" width="${bw}" height="${r1(y(below) - y(below + t))}" fill="${COLOR[l]}"/>`)
      below += t
    })
    if (i % every === 0) {
      parts.push(`<text x="${r1(x + bw / 2)}" y="${SVG_H - 6}" text-anchor="middle" font-size="10" fill="${AXIS}">${label(b.at)}</text>`)
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" font-family="sans-serif">${parts.join('')}</svg>`
}

/** What the chart says, for a reader that cannot see it. */
export function chartAlt(v: ChartView, label: (at: number) => string): string {
  if (v.bars.length === 0) return 'Effort chart: no model calls yet.'
  const counts = ORDER.map((l, i) => `${TITLE[l].toLowerCase()} ${kTokens(v.tokens[i])}`).join(', ')
  return `Effort chart: output tokens per ${v.minutes} minutes from ${label(v.bars[0].at)} to ${label(v.bars.at(-1)!.at)}; ${counts}.`
}

/** The terminal, which draws no Svg: one text row per column with a mark per level, the tallest 20 marks wide. */
export const MARK: Record<EffortLevel, string> = { medium: '░', high: '▒', xhigh: '▓', max: '█' }
export function textRows(v: ChartView, label: (at: number) => string): string[] {
  const peak = Math.max(1, ...v.bars.map(b => total(b.tok)))
  return v.bars.map(b => {
    const bar = ORDER.map((l, i) => (b.tok[i] === 0 ? '' : MARK[l].repeat(Math.max(1, Math.round((b.tok[i] * 20) / peak))))).join('')
    return `${label(b.at)} ${bar.padEnd(23)} ${kTokens(total(b.tok))}`
  })
}

/** Local `HH:MM`. */
export const clockLabel = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
