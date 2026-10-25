import { describe, expect, mock, test } from 'claude-code/testing'

// A seeded random sweep of the effort rules through the real hooks module: prompts, EFFORT answers, idle gaps that hit
// the 60 s and 10-minute boundaries, and steps, checked after every step against the rules each answer must obey:
//   I1  the effort sent is never above Claude's latest answer (medium before any answer), except while the 60 s hold
//       keeps the current effort unchanged;
//   I3  the effort never changes sooner than 60 s after the last change;
//   I6  a medium or high answer applies at the first step once the current effort has stood 60 s;
//   I8  after the 10-minute cap stops xhigh or max during a turn, that level is sent again only after an answer of it
//       given at or after the cap (each has its own clock);
//   I9  on the first step after a prompt, an xhigh or max answer given at or after its last cap applies once the effort
//       has stood 60 s (a run that ran out while idle does not block it).
// The hand-written stories in answer.test.ts missed the idle path once; this sweeps the combinations instead.

const OPUS = 'claude-opus-5-5'
const MIN = 60_000
const L = ['medium', 'high', 'xhigh', 'max'] as const
const GAPS = [0, 5_000, 30_000, 59_000, 60_000, 61_000, 2 * MIN, 9 * MIN + 59_000, 10 * MIN, 15 * MIN, 40 * MIN]

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

async function sweep($: any, on: any, seed: number, events: number) {
  const clock = mock.clock(on)
  const efforts = harness(on)
  const r = rng(seed)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  let now = 0
  let latest = 0 // medium before any answer
  const answerAt: Record<number, number | undefined> = {}
  let prev: string | undefined
  let lastChange = -Infinity
  const capAt: Record<number, number | undefined> = {}
  const lastCap: Record<number, number | undefined> = {}
  let fresh = true
  let index = 0
  const log: string[] = []
  const fail = (rule: string, sent: string) =>
    `seed ${seed} ${rule}: sent ${sent} at ${now / 1000}s (latest ${L[latest]}, last change ${lastChange / 1000}s)\n` +
    log.slice(-14).join('\n')
  await $.turn.start({ turnId: 't1', text: 'start' })
  for (let i = 0; i < events; i++) {
    if (r() < 0.12) {
      await $.turn.start({ turnId: 't1', text: 'next' })
      index = 0
      fresh = true
      log.push(`${now / 1000}s prompt`)
    }
    if (r() < 0.35) {
      latest = Math.floor(r() * 4)
      if (latest >= 2) answerAt[latest] = now
      await $.tool.call({ tool: 'Bash', command: `echo "EFFORT=${L[latest]}"` })
      log.push(`${now / 1000}s answer ${L[latest]}`)
    }
    if (r() < 0.6) {
      const gap = GAPS[Math.floor(r() * GAPS.length)]
      await clock.advance(gap)
      now += gap
    }
    const s = $.turn.step({ turnId: 't1', index: index++, model: OPUS, effort: 'medium', messageCount: 1 })
    for await (const _ of s) void _
    const sent = efforts.at(-1) as string
    log.push(`${now / 1000}s step -> ${sent}`)
    const stood = now - lastChange >= MIN
    // Above the latest answer only while the 60 s hold keeps the current effort unchanged.
    expect(L.indexOf(sent as any) <= latest || (sent === prev && !stood), fail('I1 above the latest answer', sent)).toBe(true)
    if (prev !== undefined && sent !== prev) expect(stood, fail('I3 changed within 60 s', sent)).toBe(true)
    if (latest < 2 && (prev === undefined || stood)) expect(sent, fail('I6 medium or high answer not applied', sent)).toBe(L[latest])
    const at = answerAt[latest]
    if (latest >= 2 && fresh && stood && at !== undefined && (lastCap[latest] === undefined || at >= (lastCap[latest] as number)))
      expect(sent, fail('I9 capped-level answer blocked on a new prompt', sent)).toBe(L[latest])
    if (latest >= 2 && prev === L[latest] && sent === 'medium' && stood) {
      capAt[latest] ??= now
      lastCap[latest] = now
    }
    fresh = false
    const si = L.indexOf(sent as any)
    if (si >= 2 && capAt[si] !== undefined) {
      const a = answerAt[si]
      expect(a !== undefined && a >= (capAt[si] as number), fail('I8 spent run came back', sent)).toBe(true)
      capAt[si] = undefined
    }
    if (sent !== prev) lastChange = now
    prev = sent
  }
}

describe('rule sweep', () => {
  for (const seed of [1, 2, 3, 20261016]) {
    test(`seed ${seed}: 1500 random events keep I1, I3, I6, I8 and I9`, async ($, on) => {
      await sweep($, on, seed, 1500)
    })
  }
})
