// adaptive-effort · Copyright (c) 2026 hu-ghazal · https://github.com/hu-ghazal/Ghazal-Dev-Tools
// Shared under the PolyForm Noncommercial License 1.0.0 (see LICENSE). You are welcome to use, study and adapt it for
// noncommercial purposes; please keep this notice and the licence with any copy, and credit the original.
// Commercial use needs a separate licence.

// Effort levels, the effort rules and the limits adaptive-effort applies to Claude's own effort answer. Pure functions:
// no engine calls, so tests exercise them directly.

import { kTokens } from './chart'

export const LEVELS = ['medium', 'high', 'xhigh', 'max'] as const
export type Level = (typeof LEVELS)[number]

/** The effort to send for a level index, never below medium. */
export function applied(level: number): Level {
  return LEVELS[Math.min(3, Math.max(0, Math.trunc(level)))] ?? 'medium'
}

/**
 * The model's family and version from its id: `claude-opus-5-5` is Opus 5.5, `claude-fable-5-1[1m]` Fable 5.1,
 * `claude-sonnet-5-5` Sonnet 5.5, `claude-opus-6-20270101` Opus 6 (a dated suffix is not a minor version). Undefined
 * for other ids.
 */
export function modelVersion(model: string): { family: 'opus' | 'fable' | 'sonnet'; major: number; minor: number } | undefined {
  const m = /(?:^|[^a-z])(opus|fable|sonnet)-(\d{1,2})(?:-(\d{1,2}))?(?![\d])/i.exec(model)
  if (!m) return undefined
  return { family: (m[1] ?? '').toLowerCase() as 'opus' | 'fable' | 'sonnet', major: Number(m[2]), minor: m[3] === undefined ? 0 : Number(m[3]) }
}

/** The lowest major version the mod handles. */
export const MIN_MAJOR = 5

/** The highest level the mod sends for a model: Opus, Fable and Sonnet 5 and later reach max; other models are left alone. */
export const topLevel = (model: string): number | undefined => {
  const v = modelVersion(model)
  if (!v || v.major < MIN_MAJOR) return undefined
  return 3
}

/** The status line: the effort sent and the highest the mod may send this model. */
export const statusText = (effort: string, model: string): string => {
  const top = topLevel(model)
  const name = bold(levelName(effort))
  return top === undefined ? name : `${name} (up to ${levelName(LEVELS[top] ?? 'max')})`
}

/** An effort's display name. */
export const levelName = (effort: string): string =>
  ({ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' } as Record<string, string>)[effort] ?? effort

/**
 * Bold by its letters: A-Z and a-z become Unicode Mathematical Sans-Serif Bold, the only bold a plain-text status line
 * can carry. Other characters are kept.
 */
export const bold = (text: string): string =>
  Array.from(text, c => {
    const n = c.charCodeAt(0)
    if (n >= 65 && n <= 90) return String.fromCodePoint(0x1d5d4 + n - 65)
    if (n >= 97 && n <= 122) return String.fromCodePoint(0x1d5ee + n - 97)
    return c
  }).join('')

/** The shortest time an effort stands before it may change. */
export const MIN_DWELL_MS = 60_000

/**
 * Holds the current effort until it has stood MIN_DWELL_MS; `changedAt` is when it last changed (undefined: never
 * applied, so the first value applies at once).
 */
export function dwell(
  current: Level | undefined,
  desired: Level,
  changedAt: number | undefined,
  now: number,
): { effort: Level; changed: boolean } {
  if (current === undefined || changedAt === undefined) return { effort: desired, changed: true }
  if (desired === current || now - changedAt < MIN_DWELL_MS) return { effort: current, changed: false }
  return { effort: desired, changed: true }
}

/** The longest run of max. */
export const MAX_HOLD_MS = 600_000

/**
 * When the running max was first sent (`since`), whether max is blocked (`capped`), and when the cap last stopped a
 * run of max during a turn (`endedAt`, kept until a new run starts).
 */
export type MaxClock = { since?: number; capped: boolean; endedAt?: number }

/**
 * Caps a run of max at MAX_HOLD_MS: then max drops to medium and stays blocked until a new prompt (`fresh`). A new
 * prompt lifts the cap only once the run has ended; it never lengthens a run inside its limit.
 * A max answer given before the cap stopped its run (`answeredAt` < `endedAt`) is spent: it sends medium on the new
 * prompt and after it, so only a max answered again starts a new run. The limit counts wall time, so a run that ran
 * out while idle between turns is not spent: the carried max starts a new run on the next prompt.
 */
export function capMax(
  desired: Level,
  clock: MaxClock,
  now: number,
  fresh: boolean,
  answeredAt?: number,
): { effort: Level; clock: MaxClock } {
  const expired = clock.since !== undefined && now - clock.since >= MAX_HOLD_MS
  const stale = desired === 'max' && clock.endedAt !== undefined && (answeredAt === undefined || answeredAt < clock.endedAt)
  if (!clock.capped && !expired) return { effort: stale ? 'medium' : desired, clock }
  if (!fresh) {
    return { effort: desired === 'max' ? 'medium' : desired, clock: { ...clock, capped: true, endedAt: clock.endedAt ?? now } }
  }
  return { effort: stale ? 'medium' : desired, clock: clock.endedAt === undefined ? { capped: false } : { capped: false, endedAt: clock.endedAt } }
}

/** A run of max starts when max is first sent and ends when any other effort is sent; a new run forgets `endedAt`. */
export function trackMax(clock: MaxClock, sent: Level, now: number): MaxClock {
  if (sent !== 'max') return clock.endedAt === undefined ? { capped: clock.capped } : { capped: clock.capped, endedAt: clock.endedAt }
  return { since: clock.since ?? now, capped: clock.capped }
}

export const WEEK_MS = 7 * 24 * 3600 * 1000

/** One rate limit as `$.session.usage()` reports it (the fields the budget reads). */
export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

const HOUR_MS = 3600_000
/** Readings of the 7-day limit: the recent spend is measured over at most PACE_WINDOW_MS, once it spans PACE_MIN_SPAN_MS. */
export const PACE_WINDOW_MS = 6 * HOUR_MS
export const PACE_MIN_SPAN_MS = 30 * 60_000
export const PACE_SAMPLE_MS = 5 * 60_000

export type PaceSample = { at: number; used: number }
/** The readings of one week (`resetsAt` in epoch ms). */
export type PaceLog = { resetsAt?: number; samples: PaceSample[] }

const sevenDay = (limits: readonly RateLimit[]) => {
  const w = limits.find(l => l.kind === 'seven_day')
  const resets = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
  return w && Number.isFinite(resets) && Number.isFinite(w.percentUsed) ? { used: w.percentUsed, resets } : undefined
}

/** Adds a reading every PACE_SAMPLE_MS and keeps the window; a new week (reset moved, or use fell) starts over. */
export function trackPace(log: PaceLog, limits: readonly RateLimit[], now: number): PaceLog {
  const w = sevenDay(limits)
  if (!w) return log
  const sameWeek = log.resetsAt !== undefined && Math.abs(log.resetsAt - w.resets) < HOUR_MS
  let samples = sameWeek ? log.samples.filter(s => now - s.at <= PACE_WINDOW_MS && s.used <= w.used) : []
  const last = samples[samples.length - 1]
  if (!last || now - last.at >= PACE_SAMPLE_MS) samples = [...samples, { at: now, used: w.used }]
  return { resetsAt: w.resets, samples }
}

export type Budget = {
  used: number
  left: number
  hoursLeft: number
  /** % of the limit per hour the rest of the week can spend: left / hoursLeft. */
  allowed: number
  /** % per hour being spent: over the recent readings, else the week so far. */
  burn: number
  basis: 'recent' | 'week'
  /** allowed / burn: the share of the current spend the rest of the week pays for (Infinity with no spend). */
  h: number
}

/** The weekly budget from the 7-day limit; undefined without a 7-day reading or at the reset. */
export function weeklyBudget(limits: readonly RateLimit[], now: number, samples: readonly PaceSample[] = []): Budget | undefined {
  const w = sevenDay(limits)
  if (!w || w.resets <= now) return undefined
  const left = Math.max(0, 100 - w.used)
  const hoursLeft = (w.resets - now) / HOUR_MS
  const allowed = left / hoursLeft
  // The 7-day reading comes in whole percents, so a window measures only between two of its rises: an unchanged reading
  // bounds the spend and never measures zero, and one rise just after the first reading would read as a whole percent
  // in minutes. Each rise is placed at the first reading that shows it (now, when the newest reading has not been kept
  // yet); between the first and the last rise, at least PACE_MIN_SPAN_MS apart, lies a whole number of percents.
  // Otherwise the week so far decides.
  const points = [...samples.filter(s => now - s.at <= PACE_WINDOW_MS && s.used <= w.used), { at: now, used: w.used }]
  const rises = points.filter((p, i) => i > 0 && p.used > points[i - 1].used)
  const a = rises[0]
  const z = rises[rises.length - 1]
  const recent = rises.length >= 2 && z.at - a.at >= PACE_MIN_SPAN_MS
  const hoursGone = Math.max(0, (WEEK_MS - (w.resets - now)) / HOUR_MS)
  const burn = recent ? (z.used - a.used) / ((z.at - a.at) / HOUR_MS) : hoursGone > 0 ? w.used / hoursGone : 0
  const h = left <= 0 ? 0 : burn > 0 ? allowed / burn : Infinity
  return { used: w.used, left, hoursLeft, allowed, burn, basis: recent ? 'recent' : 'week', h }
}

/** Over the weekly budget: the rest of the week pays for less than the current spend. */
export const overBudget = (b: Budget | undefined): boolean => b !== undefined && b.h < 1

/** Over this share of the 7-day limit, native subagents are flagged as not preferred. */
export const SUBAGENT_FLAG_PERCENT = 50
/** The tools that spawn a native subagent. */
export const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

/** The note when 7-day use is over SUBAGENT_FLAG_PERCENT, else undefined. A note only: the call is never blocked. */
export function subagentFlag(limits: readonly RateLimit[]): string | undefined {
  const w = sevenDay(limits)
  if (!w || !(w.used > SUBAGENT_FLAG_PERCENT)) return undefined
  return (
    `Weekly usage is ${w.used}%, over ${SUBAGENT_FLAG_PERCENT}%: native subagents are not preferred now (not blocked). ` +
    'Prefer a lighter alternative for helper work, such as a cheaper model or an external worker, where one is available.'
  )
}

/**
 * Claude's effort answer: a Bash call `echo "EFFORT=<level>"`, which the line beside each prompt asks for. The level is
 * the last `EFFORT=` token on the first line of a command that starts with echo; other tokens on the line are allowed,
 * a trailing quote or '.', ',' or ';' is ignored, and anything that is not a level (such as the template
 * "medium|high|xhigh|max") is no answer.
 */
export function parseEffortAnswer(command: unknown): number | undefined {
  if (typeof command !== 'string') return undefined
  const s = command.trimStart()
  if (!/^echo\s/.test(s)) return undefined
  let found: number | undefined
  let seen = false
  for (const raw of (s.split('\n')[0] ?? '').slice(4).trim().split(/\s+/)) {
    const tok = raw.replace(/^["']+/, '')
    const eq = tok.indexOf('=')
    if (eq <= 0 || tok.slice(0, eq).toUpperCase() !== 'EFFORT') continue
    let v = tok.slice(eq + 1).toLowerCase()
    while (v && '.,;"\''.includes(v.charAt(v.length - 1))) v = v.slice(0, -1)
    const lvl = LEVELS.indexOf(v as Level)
    seen = true
    found = lvl >= 0 ? lvl : undefined
  }
  return seen ? found : undefined
}

/**
 * The thresholds. Auto decides: Claude answers EFFORT by the effort rules. The user sets, per level, how hard that level
 * is to reach: each step Harder raises that level's counts by one, each step Easier lowers them. Harder on max also makes
 * a design decision count for max only when it spans that many systems. Over the weekly budget every count is one
 * higher; a design decision then stays max unless max is set harder.
 */
export const RAISED = ['max', 'xhigh', 'high'] as const
export type Raised = (typeof RAISED)[number]
export type Thresholds = Record<Raised, number>
export const STANDARD: Thresholds = { max: 0, xhigh: 0, high: 0 }
export const STEP_MIN = -2
export const STEP_MAX = 3
const step = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= STEP_MIN && v <= STEP_MAX ? v : undefined
/** A stored value read back: an object with a valid step for every level, else undefined. */
export function validThresholds(v: unknown): Thresholds | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  const t = { max: step(o.max), xhigh: step(o.xhigh), high: step(o.high) }
  return t.max === undefined || t.xhigh === undefined || t.high === undefined ? undefined : (t as Thresholds)
}
/** One level made harder (+1) or easier (-1), held within the steps. */
export const stepped = (t: Thresholds, level: Raised, by: number): Thresholds => ({
  ...t,
  [level]: Math.min(STEP_MAX, Math.max(STEP_MIN, t[level] + by)),
})
export const sameThresholds = (a: Thresholds, b: Thresholds): boolean => RAISED.every(l => a[l] === b[l])
export const isStandard = (t: Thresholds): boolean => sameThresholds(t, STANDARD)
/** The setting in words: "standard", "harder +1", "easier -2". */
export const difficultyWord = (n: number): string => (n === 0 ? 'default' : n > 0 ? `harder +${n}` : `easier ${n}`)

/** The counts in force; `design` is set when a design decision needs that many systems to count for max. */
export type Counts = { attempts: number; systems: number; failure: number; files: number; steps: number; design?: number }
/** Every count of a level moved by its setting, one higher over budget, each held at its floor. */
export function countsIn(t: Thresholds, over: boolean): Counts {
  const o = over ? 1 : 0
  const systems = Math.max(2, 2 + t.max + o)
  return {
    attempts: Math.max(1, 2 + t.max + o),
    systems,
    failure: Math.max(1, 3 + t.xhigh + o),
    files: Math.max(1, 3 + t.high + o),
    steps: Math.max(2, 5 + t.high + o),
    ...(t.max > 0 ? { design: systems } : {}),
  }
}
export const ordinal = (n: number): string =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
/** The counts a definition can name: `{n}` in its text, or `{nth}` as 3rd, 4th. */
export type CountKey = 'design' | 'attempts' | 'systems' | 'failure' | 'files' | 'steps'
/** One condition in two versions, for code work and for any other work; `count` is fixed, the texts are the user's. */
export type Definition = { count?: CountKey; code: string; general: string }
export type DefinedLevel = Raised | 'medium'
export const DEFINED: readonly DefinedLevel[] = ['max', 'xhigh', 'high', 'medium']
export type Definitions = Record<DefinedLevel, Definition[]>

/** The default definitions: each names something Claude can count or see, once for code work and once for any work. */
export const DEFAULT_DEFINITIONS: Definitions = {
  max: [
    {
      count: 'design',
      code: 'changing a shared interface (API, schema, data format, config contract) that {n} or more places use',
      general: 'a decision that is hard to undo and that {n} or more other parts depend on',
    },
    {
      count: 'attempts',
      code: 'a bug whose cause is still unknown after {n} attempts',
      general: 'a problem whose cause is still unknown after {n} attempts',
    },
    {
      count: 'systems',
      code: 'a change across {n} or more modules or services that must ship together',
      general: 'a change across {n} or more separate parts that must change together',
    },
  ],
  xhigh: [
    { count: 'failure', code: 'the same test or check fails a {nth} time', general: 'the same problem comes back a {nth} time' },
    { code: 'a test or check that passed earlier fails again', general: 'something believed done turns out wrong' },
    { code: 'the code behaves differently from what reading it says', general: 'a result differs from what was expected' },
  ],
  high: [
    { count: 'files', code: '{n} or more files that must stay consistent', general: '{n} or more pieces that must agree with each other' },
    {
      count: 'steps',
      code: '{n} or more steps, each confirmed by running something (build, test, script)',
      general: '{n} or more steps, each needing its own check',
    },
  ],
  medium: [
    {
      code: 'anything smaller: a clear next step, such as reading, renames, docs, config values, a fix confirmed on its first run',
      general: 'anything smaller: a clear next step where a mistake is easy to see and undo',
    },
  ],
}

/** The longest definition text kept. */
export const DEFINITION_MAX = 300

/** Saved definitions read back: the default shape with the user's texts; undefined when it is not that. */
export function validDefinitions(v: unknown): Definitions | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  const out = {} as Definitions
  for (const l of DEFINED) {
    const list = o[l]
    if (!Array.isArray(list) || list.length !== DEFAULT_DEFINITIONS[l].length) return undefined
    out[l] = []
    for (let i = 0; i < list.length; i++) {
      const d = list[i] as Record<string, unknown> | null
      const ok = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= DEFINITION_MAX
      if (typeof d !== 'object' || d === null || !ok(d.code) || !ok(d.general)) return undefined
      out[l].push({ ...DEFAULT_DEFINITIONS[l][i], code: d.code.trim(), general: d.general.trim() })
    }
  }
  return out
}
export const sameDefinitions = (a: Definitions, b: Definitions): boolean =>
  DEFINED.every(l => a[l].every((d, i) => d.code === b[l][i]?.code && d.general === b[l][i]?.general))
/** One definition text changed; the others stay. */
export function withDefinition(d: Definitions, l: DefinedLevel, i: number, side: 'code' | 'general', text: string): Definitions {
  const t = text.trim()
  if (t.length === 0 || t.length > DEFINITION_MAX || d[l][i] === undefined) return d
  return { ...d, [l]: d[l].map((x, j) => (j === i ? { ...x, [side]: t } : x)) }
}

/** One condition with its count filled in. */
export type Rule = { code: string; general: string }
/** How a condition reads beside the prompt: the code version, then the general one. */
export const ruleText = (r: Rule): string => `${r.code} (general: ${r.general})`
// A function replacement: a `$` in the user's text is never read as a pattern.
const fill = (text: string, n: number | undefined) =>
  n === undefined ? text : text.replace(/\{nth\}|\{n\}/g, m => (m === '{nth}' ? ordinal(n) : String(n)))

/** Each level's conditions with the counts in force. A design decision needs 2 places until Harder on max raises it. */
export function levelRules(c: Counts, d: Definitions = DEFAULT_DEFINITIONS): Record<DefinedLevel, Rule[]> {
  const count = (k: CountKey | undefined) => (k === undefined ? undefined : k === 'design' ? (c.design ?? 2) : c[k])
  const rules = {} as Record<DefinedLevel, Rule[]>
  for (const l of DEFINED) rules[l] = d[l].map(x => ({ code: fill(x.code, count(x.count)), general: fill(x.general, count(x.count)) }))
  return rules
}

/** A Budget's rate as a share of the week per day, to one decimal. */
const perDay = (x: number) => (Math.round(x * 240) / 10).toString()
/** The budget pays this share of the current spend or more: room for a higher level. */
export const ROOM_H = 1.5

/**
 * What Claude weighs before it answers: the week's usage against what it allows, this session's last hour, the one cost
 * rule of the pace in force, and the project signals Claude reads from the project itself. The counted conditions still
 * name the level; usage never raises one they do not support.
 */
export function usageLine(b: Budget | undefined, session?: { calls: number; tokens: readonly number[] }): string {
  const week = !b
    ? 'no weekly reading yet.'
    : `this week ${b.used}% used, ${Math.round(b.left * 10) / 10}% left for ${Math.round(b.hoursLeft)} h: ${perDay(b.allowed)}% a day ` +
      `allowed, spending ${perDay(b.burn)}% a day (${b.basis === 'recent' ? 'recent readings' : 'the week so far'}).`
  const pace = !b
    ? ''
    : b.h < 1
      ? ' Spending faster than the week allows: lean to the lower of the levels that fit, and drop back as soon as the hard part ends.'
      : b.h < ROOM_H
        ? " Close to the week's pace: weigh the work against the pace, and drop back as soon as the hard part ends."
        : ' Room in the week: a higher level that fits is affordable for hard work; drop back when it ends.'
  const all = session ? session.tokens.reduce((x, y) => x + y, 0) : 0
  const mine = !session
    ? ''
    : session.calls === 0
      ? ' This session, last hour: no calls yet.'
      : ` This session, last hour: ${session.calls} ${session.calls === 1 ? 'call' : 'calls'}, ${kTokens(all)} output tokens (` +
        LEVELS.flatMap((l, i) => (session.tokens[i] > 0 ? [`${l} ${kTokens(session.tokens[i])}`] : [])).join(', ') +
        ').'
  return (
    `Usage: ${week}${pace}${mine} When the conditions of more than one level fit, the choice among them is yours, by ` +
    'the work in front of you and this usage. Usage never raises a level the conditions do not support. ' +
    'A mistake costs more where no tests would catch it, in production, security or payment code, in a shared or public ' +
    'repository, or in code not yet read: there answer one level higher, never max on these alone.'
  )
}

/**
 * The line put beside every prompt: how to answer, the effort rules with the counts in force, and the limits. Claude
 * reads it with the prompt; it never enters the system prompt, so a change does not rewrite the cached prefix.
 */
export function rulesLine(
  t: Thresholds,
  b: Budget | undefined,
  session?: { calls: number; tokens: readonly number[] },
  d: Definitions = DEFAULT_DEFINITIONS,
): string {
  const over = overBudget(b)
  const why = [
    isStandard(t) ? '' : `thresholds set by the user: ${RAISED.map(l => `${l} ${difficultyWord(t[l])}`).join(', ')}`,
    over ? `weekly usage over budget at ${b?.used}%, every count one higher` : '',
    sameDefinitions(d, DEFAULT_DEFINITIONS) ? '' : 'definitions set by the user',
  ].filter(x => x).join('; ')
  const r = levelRules(countsIn(t, over), d)
  return (
    'adaptive-effort: decide your reasoning effort for the coming steps and answer with one Bash call, ' +
    'echo "EFFORT=medium|high|xhigh|max" (one level), before other work. Each condition is given for code work, then ' +
    '(general: ...) for other work. ' +
    DEFINED.map(l => `${l}: ${r[l].map(ruleText).join('; ')}.`).join(' ') +
    (why ? ` (Counts in force: ${why}.)` : '') +
    ' When the work changes, echo a new EFFORT; drop back as soon as the hard part ends. ' +
    usageLine(b, session) +
    ` Limits applied by the mod: ${MIN_DWELL_MS / 1000} s between changes; max at most ${MAX_HOLD_MS / 60_000} minutes, then medium until the next prompt.` +
    (over ? ' Over budget, prefer lighter helpers over native subagents.' : '')
  )
}
