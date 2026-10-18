// adaptive-effort · Copyright (c) 2026 hu-ghazal · https://github.com/hu-ghazal/Ghazal-Dev-Tools
// Shared under the PolyForm Noncommercial License 1.0.0 (see LICENSE). You are welcome to use, study and adapt it for
// noncommercial purposes; please keep this notice and the licence with any copy, and credit the original.
// Commercial use needs a separate licence.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChartLog, EffortLevel, Hold, PaceLog } from '../types'
import { LEVELS, RAISED, STANDARD, applied, capMax, countsIn, difficultyWord, editText, dwell, isStandard, levelName, levelRules, ruleText, sameDefinitions, validDefinitions, withDefinition, DEFAULT_DEFINITIONS, DEFINED, DEFINITION_MAX, overBudget, parseEffortAnswer, sameThresholds, statusText, stepped, rulesLine, topLevel, trackMax, trackPace, validThresholds, weeklyBudget, MAX_HOLD_MS, MIN_DWELL_MS, splitRule, parseSplitAnswer, splitGate, splitText, validTrigger, SPLIT_TRIGGER, SPLIT_TRIGGER_MIN, SPLIT_TRIGGER_MAX } from './classify'
import type { Definitions, DefinedLevel, Raised, Thresholds } from './classify'
import { COLOR, EMPTY_CHART, SAVE_EVERY_MS, lastHourUse, STORE_CHART, SVG_H, SVG_W, TITLE as LEVEL_TITLE, chartAlt, chartSvg, chartTitle, chartView, clockLabel, levelRows, merged, recordStep, restored, stale, TABLE_HEAD, textRows } from './chart'
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
// This session's calls and their output tokens per 15 minutes, for the pane's chart; saved in $.store for a restart.
const chart = atom({ plugin: 'adaptive-effort', key: 'chart' } as const, EMPTY_CHART)
// The level definitions Claude reads (the user's, saved in $.store, else the defaults), and whether the pane shows
// their settings.
const definitions = atom({ plugin: 'adaptive-effort', key: 'definitions' } as const, DEFAULT_DEFINITIONS as Definitions)
// Experimental split before Max: off by default, saved for new sessions; the last gate result for the pane.
const split = atom({ plugin: 'adaptive-effort', key: 'split' } as const, { on: false, trigger: SPLIT_TRIGGER } as { on: boolean; trigger: number; last?: { score: number; pass: boolean; at: number } })
const editing = atom({ plugin: 'adaptive-effort', key: 'editing' } as const, false)

const PANE = 'adaptive-effort'
const PANE_TITLE = 'Thinking effort'
const STORE_THRESHOLDS = 'thresholds'
const STORE_DEFINITIONS = 'definitions'
// On or off, kept for new sessions.
const STORE_ENABLED = 'enabled'
const STORE_SPLIT = 'split'
const STORE_SPLIT_TRIGGER = 'split-trigger'
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

/** One change to the user's definitions, applied to the current ones (two fields saved before a redraw both keep), now
 *  and as the default of new sessions. */
/** The pane button and /adaptive-effort on|off: off sends no effort and adds nothing beside the prompt; new sessions keep it. */
async function power($: EngineInterface, value: boolean) {
  await update($, enabled, () => value)
  await $.store.set(STORE_ENABLED, value).catch(() => undefined)
  if (!value) $.ui.status(undefined)
}

/** Experimental split before Max on or off, now and for new sessions. */
async function setSplit($: EngineInterface, on: boolean) {
  await update($, split, x => ({ ...x, on }))
  await $.store.set(STORE_SPLIT, on).catch(() => undefined)
}

/** The Break to simple trigger, moved by one between 1 and 9, now and for new sessions. */
async function setTrigger($: EngineInterface, by: number) {
  const x = await update($, split, s => ({ ...s, trigger: Math.min(SPLIT_TRIGGER_MAX, Math.max(SPLIT_TRIGGER_MIN, s.trigger + by)) }))
  await $.store.set(STORE_SPLIT_TRIGGER, x.trigger).catch(() => undefined)
}

/** The split rule beside the prompt while Break to simple is on, naming the trigger in force. */
async function splitRuleNow($: EngineInterface): Promise<string | undefined> {
  const s = await read($, split)
  return s.on ? splitRule(s.trigger) : undefined
}

async function saveDefinitions($: EngineInterface, change: (d: Definitions) => Definitions) {
  const d = await update($, definitions, change)
  await $.store.set(STORE_DEFINITIONS, d)
}

/** Back to the default definitions, now and for new sessions. */
async function resetDefinitions($: EngineInterface) {
  await update($, definitions, () => DEFAULT_DEFINITIONS)
  await $.store.delete(STORE_DEFINITIONS).catch(() => undefined)
}

/** Back to the standard thresholds, now and for new sessions. */
async function resetThresholds($: EngineInterface) {
  await update($, thresholds, () => STANDARD)
  await $.store.set(STORE_THRESHOLDS, STANDARD)
  await update($, saved, () => STANDARD)
}

/** Saves this session's chart in the plugin's store, so an app restart finds it ($.store, a JSON file of its own). */
async function saveChart($: EngineInterface, log: ChartLog, id?: string) {
  const key = id ?? (await $.session.id().catch(() => undefined))
  if (key !== undefined && log.buckets.length > 0) await $.store.set(STORE_CHART + key, log).catch(() => undefined)
}

// One short line per level card: a four-word general definition.
const SUMMARY: Record<Raised | 'medium', string> = {
  max: 'Hard-to-undo or unexplained problems',
  xhigh: 'Repeated or surprising failures',
  high: 'Many parts, many checks',
  medium: 'Clear steps, easily undone',
}
const cardLine = (l: Raised, n: number) => (n === 0 ? SUMMARY[l] : `${SUMMARY[l]} · ${difficultyWord(n)}`)
const describe = (t: Thresholds) => RAISED.map(l => `${l} ${difficultyWord(t[l])}`).join(', ')
const fmt = (n: number) => (Math.round(n * 10) / 10).toString()
const mins = (ms: number) => Math.round(ms / 60_000)

export const register: Register = on => {
  let shown = ''
  // A new prompt since the last step; only this lifts a capped max.
  let fresh = false
  // The thresholds Claude last read; a change during a turn reaches Claude on the next tool result.
  let delivered: Thresholds = STANDARD
  let deliveredDefinitions: Definitions = DEFAULT_DEFINITIONS
  // When this session's chart was last saved; saved at most once a minute and at the end, so it costs little.
  let savedAt = 0

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
    // The user's definitions, saved as the default of every session; with none saved, the defaults.
    const d = validDefinitions(await $.store.get(STORE_DEFINITIONS).catch(() => undefined)) ?? DEFAULT_DEFINITIONS
    await update($, definitions, () => d)
    deliveredDefinitions = d
    const isOn = (await $.store.get(STORE_ENABLED).catch(() => undefined)) !== false
    await update($, enabled, () => isOn)
    const splitOn = (await $.store.get(STORE_SPLIT).catch(() => undefined)) === true
    const trigger = validTrigger(await $.store.get(STORE_SPLIT_TRIGGER).catch(() => undefined)) ?? SPLIT_TRIGGER
    await update($, split, x => ({ ...x, on: splitOn, trigger }))
    // The chart this session saved before an app restart, and the saved charts that are spent, deleted.
    const now = await $.clock.now()
    const id = await $.session.id().catch(() => undefined)
    const back = id === undefined ? undefined : restored(await $.store.get(STORE_CHART + id).catch(() => undefined), now)
    // A plugin reload runs this too, with the chart in memory ahead of the save: merged, never replaced.
    if (back !== undefined && back.buckets.length > 0) await update($, chart, l => merged(l, back))
    // Keys this build does not own go too: only the thresholds, the definitions and the charts are its own.
    const all: [string, unknown][] = []
    for (const k of await $.store.keys().catch(() => [] as string[])) {
      all.push([k, k.startsWith(STORE_CHART) ? await $.store.get(k).catch(() => undefined) : undefined])
    }
    for (const k of stale(all, now, [STORE_THRESHOLDS, STORE_DEFINITIONS, STORE_ENABLED, STORE_SPLIT, STORE_SPLIT_TRIGGER])) await $.store.delete(k).catch(() => undefined)
    // A session with nothing that draws a pane refuses the open; the controls still work through the command.
    void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
    return next(e)
  })

  // The chart is saved once more as the session ends, so a restart finds its last minute too.
  on('session.end', async ($, e, next) => {
    await saveChart($, await read($, chart), e.sessionId)
    return next(e)
  })

  on('command.run', { command: 'adaptive-effort' }, async ($, e) => {
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'on' || word === 'off') {
      await power($, word === 'on')
      shown = ''
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
      return { text: 'adaptive-effort: thresholds back to the defaults, now and for new sessions.' }
    }
    const now = await $.clock.now()
    const h = await read($, hold)
    const t = await read($, thresholds)
    const b = await budget($, now, false)
    const r = levelRules(countsIn(t, overBudget(b)), await read($, definitions))
    const answer = h.answer
      ? `Claude answered EFFORT=${LEVELS[h.answer.level]} ${mins(now - h.answer.at)} min ago; it holds until Claude answers again.`
      : 'Claude has not answered EFFORT yet: medium.'
    const rules = DEFINED.map(l => `${l}${l === 'medium' ? '' : ` (${difficultyWord(t[l])})`}: ${r[l].map(ruleText).join('; ')}`).join('\n')
    const week = !b
      ? 'Weekly budget: no 7-day reading yet, no cap.'
      : `Weekly budget: ${b.used}% used, ${fmt(b.left)}% left over ${fmt(b.hoursLeft)} h, so ${fmt(b.allowed * 24)}% a day allowed; ` +
        `spending ${fmt(b.burn * 24)}% a day (${b.basis === 'recent' ? 'recent readings' : 'the week so far'}). ` +
        (b.h >= 1
          ? 'Within budget.'
          : `Over budget: it pays ${Math.round(b.h * 100)}% of the spend, so every count is one higher and the higher levels need more reason; an answer Claude gave is never cut down.`)
    const capped = h.max.capped ? ` Max ran ${MAX_HOLD_MS / 60_000} minutes and is held at medium until a new prompt.` : ''
    return {
      text:
        `version ${manifest.version} is ${(await read($, enabled)) ? 'on' : 'off'}; last applied effort: ${await read($, level)}.\n` +
        `${answer}\nThresholds in force (saved default: ${describe(await read($, saved))}):\n${rules}\n` +
        `Limits: a change waits until the current effort has stood ${MIN_DWELL_MS / 1000} s; max runs at most ${MAX_HOLD_MS / 60_000} minutes in a row.${capped}\n` +
        week,
    }
  })

  // How the pane says Auto works: a press changes the conditions, and the effort follows when Claude answers by them.
  const SETTINGS_EXPLAIN = `The conditions Claude reads for each level, for code work and for other work. Write each in your own words. A number in a condition is its count: type another to change it; Easier, Harder and the weekly budget still move it. Enter saves a field (up to ${DEFINITION_MAX} characters) for every session.`
  const OFF_EXPLAIN = 'Off: Claude Code keeps its own effort, and nothing is added beside your prompts. Turn on lets Claude choose again. New sessions keep this choice.'
  const SPLIT_EXPLAIN = 'Off by default. On, Claude adds a quick score out of ten when it answers Max: how well the work splits into clear pieces. A score over the number above sends High to plan, then Medium for each piece; otherwise Max stands. Set the number with − and +; it is kept for new sessions.'
  const EXPLAIN = 'Claude picks a level whose conditions match the work; where several match, it chooses by the work and the usage. Easier or Harder changes the conditions; the effort follows Claude\'s next answer.'
  // Dark text on the light level pill, white on the dark ones; the budget warning in amber.
  const PILL_TEXT: Record<EffortLevel, string> = { medium: '#1A1A18', high: '#FFFFFF', xhigh: '#FFFFFF', max: '#FFFFFF' }
  const WARN = '#E8A33D'
  const YELLOW = '#F2C94C'
  // The level cards' name pills in dark blue; the Effort now pill keeps its level's colour.
  const CARD_PILL = '#042C53'
  // Grey, not white, for the pane's text: easier on the eye.
  const GRAY = '#B4B2AC'

  // The controls: Auto decides; per level, the user sets how hard that level is to reach. One card per level, with no
  // conditions printed; Settings edits them. Below them the chart of this session's output tokens and a table of the
  // levels used.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const t = await read($, thresholds)
    const s = await read($, saved)
    const now = await read($, level)
    const at = await $.clock.now()
    const b = await budget($, at, false)
    const over = overBudget(b)
    const edit = await read($, editing)
    const d = await read($, definitions)
    const isOn = await read($, enabled)
    const sp = await read($, split)
    const counts = countsIn(t, over)
    // Settings: each definition's code and general text in a field; Enter saves it as the default of every session. The
    // mobile app draws no field, so it says where to edit.
    const field = (l: DefinedLevel, i: number, side: 'code' | 'general') =>
      'Input' in els ? (
        <els.Input
          key={`def-${l}-${i}-${side}`}
          label={side === 'code' ? 'Code: ' : 'General: '}
          value={editText(counts, d[l][i], side)}
          submitLabel="save"
          onSubmit={value => void saveDefinitions($, cur => withDefinition(cur, l, i, side, value, counts))}
        />
      ) : (
        <Text key={`def-${l}-${i}-${side}`} dimColor>{`${side === 'code' ? 'Code' : 'General'}: ${editText(counts, d[l][i], side)}`}</Text>
      )
    const settings = !edit ? null : (
      <Box key="definitions" flexDirection="column" gap={1}>
        <Box key="split" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Button key="split" label={sp.on ? '☑' : '☐'} onPress={() => setSplit($, !sp.on)} />
            <Text bold color={YELLOW}>Break to simple (experimental)</Text>
          </Box>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color={YELLOW}>Break to simple when the score is over</Text>
            <Button key="split-down" label="−" onPress={() => setTrigger($, -1)} />
            <Text key="split-trigger" bold color={YELLOW}>{String(sp.trigger)}</Text>
            <Button key="split-up" label="+" onPress={() => setTrigger($, 1)} />
          </Box>
          <Text dimColor>{SPLIT_EXPLAIN}</Text>
        </Box>
        {DEFINED.map(l => (
          <Box key={`defs-${l}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Text bold color={GRAY} backgroundColor={CARD_PILL}>{` ${l === 'medium' ? 'Medium' : TITLE[l]} `}</Text>
            {d[l].map((_, i) => (
              <Box key={`defs-${l}-${i}`} flexDirection="column">
                {field(l, i, 'code')}
                {field(l, i, 'general')}
              </Box>
            ))}
          </Box>
        ))}
        {'Input' in els ? null : <Text dimColor>Definitions are edited on desktop or in the terminal.</Text>}
        <Box flexDirection="row" gap={1}>
          <Button key="definitions-reset" label="Reset definitions to default" onPress={() => resetDefinitions($)} />
        </Box>
        <Text dimColor>{sameDefinitions(d, DEFAULT_DEFINITIONS) ? 'Definitions: default' : 'Definitions: your own, saved for new sessions'}</Text>
      </Box>
    )
    const v = chartView(await read($, chart), at)
    // The chart drawn in a frame of fixed size where the surface draws Svg; the terminal gets text rows.
    const drawn =
      e.surface !== 'terminal' && 'Svg' in els ? (
        <els.Svg key="chart" source={chartSvg(v, clockLabel)} alt={chartAlt(v, clockLabel)} width={SVG_W} height={SVG_H} />
      ) : (
        textRows(v, clockLabel).map((row, i) => <Text key={`row-${i}`} color={GRAY}>{row}</Text>)
      )
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Box flexDirection="row" alignItems="center" gap={1}>
              <Text bold color={GRAY}>Effort now</Text>
              {isOn ? (
                <Text bold color={PILL_TEXT[now]} backgroundColor={COLOR[now]}>{` ${levelName(now)} `}</Text>
              ) : (
                <Text bold color={GRAY} backgroundColor={CARD_PILL}> Off </Text>
              )}
            </Box>
            <Box flexDirection="row">
              <Button key="power" label={isOn ? 'Turn off' : 'Turn on'} onPress={() => { shown = ''; return power($, !isOn) }} />
              <Button key="settings" label={edit ? 'Done' : 'Settings'} onPress={() => update($, editing, x => !x)} />
            </Box>
          </Box>
          <Text dimColor>{edit ? SETTINGS_EXPLAIN : isOn ? EXPLAIN : OFF_EXPLAIN}</Text>
        </Box>
        {edit ? settings : null}
        {edit ? null : RAISED.map(l => (
          <Box key={`level-${l}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Box flexDirection="row" alignItems="center" justifyContent="space-between">
              <Box flexDirection="row" alignItems="center" gap={1}>
                <Text bold color={GRAY} backgroundColor={CARD_PILL}>{` ${TITLE[l]} `}</Text>
                <Text dimColor>{cardLine(l, t[l])}</Text>
              </Box>
              <Box flexDirection="row">
                <Button key={`${l}-easier`} label="Easier" onPress={() => update($, thresholds, x => stepped(x, l, -1))} />
                <Button key={`${l}-harder`} label="Harder" onPress={() => update($, thresholds, x => stepped(x, l, 1))} />
              </Box>
            </Box>
          </Box>
        ))}
        {edit ? null : (
          <Box flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderDimColor paddingX={1}>
            <Text bold color={GRAY} backgroundColor={CARD_PILL}> Medium </Text>
            <Text dimColor>{SUMMARY.medium}</Text>
          </Box>
        )}
        {!edit && isOn && sp.on ? <Text dimColor>{`Break to simple (experimental) is on${sp.last ? `; last: ${splitText(sp.last.score, sp.trigger)}, ${sp.last.pass ? 'High to plan' : 'Max stood'}` : '; no Max answer yet'}.`}</Text> : null}
        {over ? <Text color={WARN}>{`⚠ ${b?.used}% of this week's limit is used, faster than the week allows. So High, Extra high and Max are one step harder to reach until that eases.`}</Text> : null}
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="save" label="Save as default" hotkey="s" variant="primary" onPress={() => saveThresholds($)} />
            <Button key="reset" label="Reset to default" hotkey="r" onPress={() => resetThresholds($)} />
          </Box>
          <Text dimColor>{`Default for new sessions: ${isStandard(s) ? 'the defaults' : describe(s)}${sameThresholds(t, s) ? '' : ' (current settings not saved)'}`}</Text>
        </Box>
        <Text bold color={GRAY}>{chartTitle(v)}</Text>
        {v.bars.length === 0 ? (
          <Text dimColor>No model calls yet since this build loaded.</Text>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="column" marginBottom={1}>
              {[TABLE_HEAD, ...levelRows(v)].map((row, i) => (
                <Box key={`row-${row.level}`} flexDirection="row">
                  <Box width={14} flexDirection="row">
                    {i === 0 ? <Text dimColor>{row.level}</Text> : <Text color={COLOR[row.level as EffortLevel]}>■</Text>}
                    {i === 0 ? null : <Text color={GRAY}>{` ${LEVEL_TITLE[row.level as EffortLevel]}`}</Text>}
                  </Box>
                  <Box width={9}><Text dimColor={i === 0} color={i === 0 ? undefined : GRAY}>{row.calls}</Text></Box>
                  <Box width={10}><Text dimColor={i === 0} color={i === 0 ? undefined : GRAY}>{row.each}</Text></Box>
                  <Box width={10}><Text dimColor={i === 0} color={i === 0 ? undefined : GRAY}>{row.share}</Text></Box>
                </Box>
              ))}
            </Box>
            {drawn}
          </Box>
        )}
      </Box>
    )
  })

  // The rules with the thresholds in force go beside each prompt: never in the system prompt, so a change of the
  // thresholds or the budget does not rewrite the cached prefix.
  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const t = await read($, thresholds)
    delivered = t
    const now = await $.clock.now()
    // The usage goes with the rules, so Claude weighs the cost before it answers.
    const d = await read($, definitions)
    deliveredDefinitions = d
    const line = rulesLine(t, await budget($, now, false), lastHourUse(await read($, chart), now), d)
    const rule = [await splitRuleNow($)].filter((x): x is string => x !== undefined)
    return next({ ...e, context: [...(e.context ?? []), line, ...rule] })
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
          let answered = lvl
          // Experimental split: Claude's blind score out of ten, then split when it is over the trigger.
          const sp = await read($, split)
          const score = sp.on && lvl === LEVELS.indexOf('max') ? parseSplitAnswer(ev.command ?? ev.input?.command) : undefined
          if (score !== undefined) {
            const g = splitGate(score, sp.trigger)
            await update($, split, x => ({ ...x, last: { score, pass: g.pass, at } }))
            if (g.pass) answered = LEVELS.indexOf('high')
            extra.push(
              g.pass
                ? `adaptive-effort: ${splitText(score, sp.trigger)}: split. This step runs at High: write the plan of the pieces, then answer EFFORT=medium and do each piece in this conversation, not in subagents.`
                : `adaptive-effort: ${splitText(score, sp.trigger)}: no split; Max stands.`,
            )
          }
          await update($, hold, s => ({ ...s, answer: { level: answered, at } }))
        }
      }
      // The user changed a threshold or a definition during this turn: the new rules reach Claude now, once.
      const t = await read($, thresholds)
      const d = await read($, definitions)
      if (!sameThresholds(t, delivered) || !sameDefinitions(d, deliveredDefinitions)) {
        delivered = t
        deliveredDefinitions = d
        const line = rulesLine(t, await budget($, await $.clock.now(), false), undefined, d)
        extra.push(`The rules changed. ${line} Answer EFFORT again by these rules.`)
      }
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
    // The chart records the call once its response is in, with the output tokens it spent: one write per call.
    const r = yield* next({ ...e, effort })
    const log = await update($, chart, l => recordStep(l, effort, now, r?.usage?.output_tokens ?? 0))
    if (now - savedAt >= SAVE_EVERY_MS) {
      savedAt = now
      await saveChart($, log)
    }
    return r
  })
}
