import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EffortLevel, Hold, PaceLog } from '../types'
import { LEVELS, RAISED, STANDARD, applied, capMax, countsIn, difficultyWord, dwell, isStandard, levelName, levelRules, overBudget, parseEffortAnswer, sameThresholds, statusText, stepped, subagentFlag, rulesLine, topLevel, trackMax, trackPace, validThresholds, weeklyBudget, MAX_HOLD_MS, MIN_DWELL_MS, SUBAGENT_TOOLS } from './classify'
import type { Raised, Thresholds } from './classify'
import { manifest } from './version'

// adaptive-effort: Claude decides its own reasoning effort. Beside each prompt the mod puts the effort rules and asks
// Claude to answer with `echo "EFFORT=<level>"`; it sends that level on Opus, Fable and Sonnet 5+ main-loop steps (medium
// to max), within a 60 s hold between changes and a 10-minute limit on max. A side pane sets how hard each level is to
// reach; over the weekly budget every count is one higher. The effort sent is never lowered by the budget, and the mod
// makes no model call.

const enabled = atom({ plugin: 'adaptive-effort', key: 'enabled' } as const, true)
const level = atom({ plugin: 'adaptive-effort', key: 'level' } as const, 'medium' as EffortLevel)
// The hold base, the max clock and Claude's latest answer: a reload or a replaced worker keeps them.
const hold = atom({ plugin: 'adaptive-effort', key: 'hold' } as const, { max: { capped: false } } as Hold)
// Readings of the 7-day limit, for the recent burn rate of the weekly budget.
const paceLog = atom({ plugin: 'adaptive-effort', key: 'pace' } as const, { samples: [] } as PaceLog)
// The user's thresholds (per level, easier -2 .. harder +3) and the saved default new sessions start from.
const thresholds = atom({ plugin: 'adaptive-effort', key: 'thresholds' } as const, STANDARD as Thresholds)
const saved = atom({ plugin: 'adaptive-effort', key: 'saved' } as const, STANDARD as Thresholds)

const PANE = 'adaptive-effort'
const PANE_TITLE = 'Thinking effort'
const STORE_THRESHOLDS = 'thresholds'
const TITLE: Record<Raised, string> = { max: 'Max', xhigh: 'Extra high', high: 'High' }

/** The weekly budget from the last response's 7-day limit (local; no request); `record` adds the reading. */
async function budget($: EngineInterface, now: number, record: boolean) {
  const limits = (await $.session.usage().catch(() => undefined))?.rateLimits ?? []
  const log = record ? await update($, paceLog, l => trackPace(l, limits, now)) : await read($, paceLog)
  return weeklyBudget(limits, now, log.samples)
}

/** Saves the thresholds as the default of new sessions ($.store, kept across sessions). */
async function saveThresholds($: EngineInterface) {
  const t = await read($, thresholds)
  await $.store.set(STORE_THRESHOLDS, t)
  await update($, saved, () => t)
  return t
}

/** Back to the standard thresholds, now and for new sessions. */
async function resetThresholds($: EngineInterface) {
  await update($, thresholds, () => STANDARD)
  await $.store.set(STORE_THRESHOLDS, STANDARD)
  await update($, saved, () => STANDARD)
}

const describe = (t: Thresholds) => RAISED.map(l => `${l} ${difficultyWord(t[l])}`).join(', ')
const fmt = (n: number) => (Math.round(n * 10) / 10).toString()
const mins = (ms: number) => Math.round(ms / 60_000)

export const register: Register = on => {
  let shown = ''
  // A new prompt since the last step; only this lifts a capped max.
  let fresh = false
  // The thresholds Claude last read; a change during a turn reaches Claude on the next tool result.
  let delivered: Thresholds = STANDARD

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'adaptive-effort',
      description: 'Show the effort and why; "pane" opens the controls; "max|xhigh|high harder|easier" sets a threshold; "save", "reset", "on" or "off".',
    })
    // The saved thresholds are the default this session starts from; with none saved, the standard ones.
    const s = validThresholds(await $.store.get(STORE_THRESHOLDS).catch(() => undefined)) ?? STANDARD
    await update($, saved, () => s)
    await update($, thresholds, () => s)
    delivered = s
    // A session with nothing that draws a pane refuses the open; the controls still work through the command.
    void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'adaptive-effort' }, async ($, e) => {
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'on' || word === 'off') {
      await update($, enabled, () => word === 'on')
      if (word === 'off') {
        shown = ''
        $.ui.status(undefined)
      }
      return { text: `adaptive-effort ${word}.` }
    }
    if (word === 'pane') {
      // Asked by the person, so focus raises the pane: re-opening an open pane only retitles it, and another plugin's
      // pane opened after it at session start stays in front.
      const r = await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true }).catch(() => undefined)
      const me = (await $.ui.panes().catch(() => [])).find(x => x.id === PANE)
      if (!r?.isPlaced) return { text: `adaptive-effort: the pane is not drawn here${r && 'reason' in r ? ` (${r.reason})` : ''}; /adaptive-effort max harder and save work without it.` }
      return { text: me?.isShown ? 'Thinking effort pane shown.' : 'Thinking effort pane is open behind another pane: click its "Thinking effort" tab.' }
    }
    if ((RAISED as readonly string[]).includes(word)) {
      if (value !== 'harder' && value !== 'easier') return { text: `adaptive-effort: ${word} takes harder or easier.` }
      const t = await update($, thresholds, x => stepped(x, word as Raised, value === 'harder' ? 1 : -1))
      return { text: `adaptive-effort: ${word} is ${difficultyWord(t[word as Raised])} for this session; "save" keeps it for new sessions.` }
    }
    if (word === 'save') return { text: `adaptive-effort: thresholds ${describe(await saveThresholds($))} saved as the default of new sessions.` }
    if (word === 'reset') {
      await resetThresholds($)
      return { text: 'adaptive-effort: thresholds back to standard, now and for new sessions.' }
    }
    const now = await $.clock.now()
    const h = await read($, hold)
    const t = await read($, thresholds)
    const b = await budget($, now, false)
    const r = levelRules(countsIn(t, overBudget(b)))
    const answer = h.answer
      ? `Claude answered EFFORT=${LEVELS[h.answer.level]} ${mins(now - h.answer.at)} min ago; it holds until Claude answers again.`
      : 'Claude has not answered EFFORT yet: medium.'
    const rules = RAISED.map(l => `${l} (${difficultyWord(t[l])}): ${r[l].join('; ')}`).join('\n')
    const week = !b
      ? 'Weekly budget: no 7-day reading yet, no cap.'
      : `Weekly budget: ${b.used}% used, ${fmt(b.left)}% left over ${fmt(b.hoursLeft)} h, so ${fmt(b.allowed * 24)}% a day allowed; ` +
        `spending ${fmt(b.burn * 24)}% a day (${b.basis === 'recent' ? 'recent readings' : 'the week so far'}). ` +
        (b.h >= 1
          ? 'Within budget.'
          : `Over budget: it pays ${Math.round(b.h * 100)}% of the spend, so every count is one higher; the effort sent is never lowered.`)
    const capped = h.max.capped ? ` Max ran ${MAX_HOLD_MS / 60_000} minutes and is held at medium until a new prompt.` : ''
    const flag = subagentFlag((await $.session.usage().catch(() => undefined))?.rateLimits ?? [])
    return {
      text:
        `version ${manifest.version} is ${(await read($, enabled)) ? 'on' : 'off'}; last applied effort: ${await read($, level)}.\n` +
        `${answer}\nThresholds in force (saved default: ${describe(await read($, saved))}):\n${rules}\n` +
        `Limits: a change waits until the current effort has stood ${MIN_DWELL_MS / 1000} s; max runs at most ${MAX_HOLD_MS / 60_000} minutes in a row.${capped}\n` +
        week +
        (flag ? `\nSubagents: ${flag}` : ''),
    }
  })

  // The controls: Auto decides; per level, the user sets how hard that level is to reach. One
  // block per level, each condition on its own line. Box, Text and Button only, which every surface draws.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, thresholds)
    const s = await read($, saved)
    const now = await read($, level)
    const b = await budget($, await $.clock.now(), false)
    const over = overBudget(b)
    const r = levelRules(countsIn(t, over))
    return (
      <Box flexDirection="column">
        <Text bold>{`Effort now: ${levelName(now)}`}</Text>
        <Text dimColor>Auto: Claude picks the first level whose conditions match the work.</Text>
        {RAISED.map(l => (
          <Box key={`level-${l}`} flexDirection="column">
            <Text> </Text>
            <Box flexDirection="row">
              <Text bold>{`${TITLE[l]} when   `}</Text>
              <Button key={`${l}-easier`} label="Easier" onPress={() => update($, thresholds, x => stepped(x, l, -1))} />
              <Button key={`${l}-harder`} label="Harder" onPress={() => update($, thresholds, x => stepped(x, l, 1))} />
              <Text dimColor>{`   ${difficultyWord(t[l])}`}</Text>
            </Box>
            {r[l].map((c, i) => (
              <Text key={`${l}-c${i}`}>{`  • ${c}`}</Text>
            ))}
          </Box>
        ))}
        <Text> </Text>
        <Text bold>Medium otherwise</Text>
        {over ? <Text dimColor>{`Weekly usage over budget (${b?.used}% used): every count above is one higher than set.`}</Text> : <Text> </Text>}
        <Text> </Text>
        <Box flexDirection="row">
          <Button key="save" label="Save as default" hotkey="s" onPress={() => saveThresholds($)} />
          <Button key="reset" label="Reset to standard" hotkey="r" onPress={() => resetThresholds($)} />
        </Box>
        <Text dimColor>{`Default for new sessions: ${isStandard(s) ? 'standard' : describe(s)}${sameThresholds(t, s) ? '' : ' (current settings not saved)'}`}</Text>
      </Box>
    )
  })

  // The rules with the thresholds in force go beside each prompt: never in the system prompt, so a change of the
  // thresholds or the budget does not rewrite the cached prefix.
  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const t = await read($, thresholds)
    delivered = t
    const line = rulesLine(t, await budget($, await $.clock.now(), false))
    return next({ ...e, context: [...(e.context ?? []), line] })
  })

  on('turn.start', async ($, e, next) => {
    fresh = true
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || r.deny !== undefined) return r
    const extra: string[] = []
    if (await read($, enabled)) {
      // Claude's effort answer: only the main loop's own echo.
      if (e.tool === 'Bash') {
        const ev = e as { command?: unknown; input?: { command?: unknown } }
        const lvl = parseEffortAnswer(ev.command ?? ev.input?.command)
        if (lvl !== undefined) {
          const at = await $.clock.now()
          await update($, hold, s => ({ ...s, answer: { level: lvl, at } }))
        }
      }
      // The user changed a threshold during this turn: the new thresholds reach Claude now, once.
      const t = await read($, thresholds)
      if (!sameThresholds(t, delivered)) {
        delivered = t
        const line = rulesLine(t, await budget($, await $.clock.now(), false))
        extra.push(`The thresholds changed. ${line} Answer EFFORT again by these rules.`)
      }
    }
    // Over half the week's limit, a native subagent is flagged as not preferred; never blocked.
    if (SUBAGENT_TOOLS.has(e.tool)) {
      const flag = subagentFlag((await $.session.usage().catch(() => undefined))?.rateLimits ?? [])
      if (flag !== undefined) extra.push(flag)
    }
    return extra.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...extra] }
  })

  on('turn.step', async function* ($, e, next) {
    const top = e.agentId === undefined ? topLevel(e.model) : undefined
    if (top === undefined || e.effort === undefined || !(await read($, enabled))) {
      return yield* next(e)
    }
    const now = await $.clock.now()
    const h = await read($, hold)
    // Claude's latest answer decides; before the first answer, medium.
    const want = Math.min(top, h.answer?.level ?? 0)
    // The 7-day readings are kept for the budget step and /adaptive-effort; the budget never lowers the effort.
    await budget($, now, true)
    const cap = capMax(applied(want), h.max, now, fresh, h.answer?.at)
    fresh = false
    let { current, changedAt } = h
    const held = dwell(current, cap.effort, changedAt, now)
    const effort = applied(Math.min(top, LEVELS.indexOf(held.effort)))
    const max = trackMax(cap.clock, effort, now)
    if (held.changed || effort !== current) {
      current = effort
      changedAt = now
    }
    await update($, hold, s => ({ ...s, current, changedAt, max }))
    await update($, level, () => effort)
    const status = statusText(effort, e.model)
    if (status !== shown) {
      shown = status
      $.ui.status(status)
    }
    return yield* next({ ...e, effort })
  })
}
