// Effort levels, the effort rules and the limits adaptive-effort applies to Claude's own effort answer. Pure functions:
// no engine calls, so tests exercise them directly.

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

/** When the running max was first sent (`since`) and whether max is blocked (`capped`). */
export type MaxClock = { since?: number; capped: boolean }

/**
 * Caps a run of max at MAX_HOLD_MS: then max drops to medium and stays blocked until a new prompt (`fresh`). A new
 * prompt lifts the cap only once the run has ended; it never lengthens a run inside its limit.
 */
export function capMax(desired: Level, clock: MaxClock, now: number, fresh: boolean): { effort: Level; clock: MaxClock } {
  const expired = clock.since !== undefined && now - clock.since >= MAX_HOLD_MS
  if (!clock.capped && !expired) return { effort: desired, clock }
  if (!fresh) return { effort: desired === 'max' ? 'medium' : desired, clock: { ...clock, capped: true } }
  return { effort: desired, clock: { capped: false } }
}

/** A run of max starts when max is first sent and ends when any other effort is sent. */
export function trackMax(clock: MaxClock, sent: Level, now: number): MaxClock {
  if (sent !== 'max') return { capped: clock.capped }
  return { since: clock.since ?? now, capped: clock.capped }
}

export const WEEK_MS = 7 * 24 * 3600 * 1000

/** One rate limit as `$.session.usage()` reports it (the fields the budget reads). */
export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

const HOUR_MS = 3600_000
/** Readings of the 7-day limit: the recent spend is measured over at most PACE_WINDOW_MS, once it spans PACE_MIN_SPAN_MS. */
export const PACE_WINDOW_MS = 2 * HOUR_MS
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
  const first = samples.find(s => now - s.at <= PACE_WINDOW_MS && s.used <= w.used)
  const recent = first !== undefined && now - first.at >= PACE_MIN_SPAN_MS
  const hoursGone = Math.max(0, (WEEK_MS - (w.resets - now)) / HOUR_MS)
  const burn = recent ? (w.used - first.used) / ((now - first.at) / HOUR_MS) : hoursGone > 0 ? w.used / hoursGone : 0
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
export const difficultyWord = (n: number): string => (n === 0 ? 'standard' : n > 0 ? `harder +${n}` : `easier ${n}`)

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
/** Each level's conditions in full words, with the counts in force. */
export function levelRules(c: Counts): Record<Raised, string[]> {
  return {
    max: [
      c.design === undefined
        ? 'a design or architecture decision with real trade-offs'
        : `a design or architecture decision with real trade-offs that spans ${c.design} or more systems`,
      `a failure still unexplained after ${c.attempts} ${c.attempts === 1 ? 'attempt' : 'attempts'}`,
      `a change across ${c.systems} or more systems where a wrong fix is likely`,
    ],
    xhigh: [
      c.failure === 1 ? 'any failure' : `the same kind of failure a ${ordinal(c.failure)} time`,
      'a fix that did not hold',
      'results that contradict expectations',
    ],
    high: [
      `${c.files} or more ${c.files === 1 ? 'file or component' : 'files or components'} that must stay consistent`,
      `a procedure of ${c.steps} or more steps with checks`,
    ],
  }
}

/**
 * The line put beside every prompt: how to answer, the effort rules with the counts in force, and the limits. Claude
 * reads it with the prompt; it never enters the system prompt, so a change does not rewrite the cached prefix.
 */
export function rulesLine(t: Thresholds, b: Budget | undefined): string {
  const over = overBudget(b)
  const why = [
    isStandard(t) ? '' : `thresholds set by the user: ${RAISED.map(l => `${l} ${difficultyWord(t[l])}`).join(', ')}`,
    over ? `weekly usage over budget at ${b?.used}%, every count one higher` : '',
  ].filter(x => x).join('; ')
  const r = levelRules(countsIn(t, over))
  return (
    'adaptive-effort: decide your reasoning effort for the coming steps and answer with one Bash call, ' +
    'echo "EFFORT=medium|high|xhigh|max" (one level), before other work. Take the first level whose conditions match. ' +
    RAISED.map(l => `${l}: ${r[l].join('; ')}.`).join(' ') +
    ' medium: everything else, including small fixes, reading, reporting and routine edits.' +
    (why ? ` (Counts in force: ${why}.)` : '') +
    ' When the work changes, echo a new EFFORT; drop back as soon as the hard part ends.' +
    ` Limits applied by the mod: ${MIN_DWELL_MS / 1000} s between changes; max at most ${MAX_HOLD_MS / 60_000} minutes, then medium until the next prompt.` +
    (over ? ' Over budget, prefer lighter helpers over native subagents.' : '')
  )
}
