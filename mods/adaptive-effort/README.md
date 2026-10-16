<p align="center">
  <img src="assets/banner.svg" alt="adaptive-effort: Claude shifts its own thinking gear" width="100%">
</p>

<p align="center">
  <img src="assets/effort-history.svg" alt="Twelve hours of one real Claude Code session with adaptive-effort: 1,413 model calls, 36 effort answers, 12 effort changes and 3 runs of max; per hour, the share of calls at medium, high and max" width="100%">
  <br>
  <sub>Twelve hours of one real session: Claude stays on medium for easy stretches and shifts up to high or max when the work gets hard.</sub>
</p>

<h1 align="center">🏎️ adaptive-effort</h1>

<p align="center">
  <b>An automatic gearbox for Claude's thinking.</b><br>
  A Claude Code mod that lets Claude shift its own reasoning effort, by clear rules you control.
</p>

<p align="center">
  <a href="CHANGELOG.md"><img alt="Version 1.0.2" src="https://img.shields.io/badge/version-1.0.2-e10600?style=for-the-badge"></a>
  <img alt="Claude Code mod" src="https://img.shields.io/badge/Claude%20Code-mod-e10600?style=for-the-badge">
  <img alt="Gears" src="https://img.shields.io/badge/gears-medium%20%C2%B7%20high%20%C2%B7%20xhigh%20%C2%B7%20max-2b2f36?style=for-the-badge">
  <img alt="No model calls" src="https://img.shields.io/badge/model%20calls-none-2b2f36?style=for-the-badge">
  <img alt="License PolyForm Noncommercial" src="https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-2b2f36?style=for-the-badge">
</p>

---

Claude spends more thinking on hard work and less on easy work, like an automatic gearbox that shifts up for a climb
and back down on the straight. You decide how hard each gear is to reach, from a side pane, and the mod keeps the
shifting smooth and the most expensive gear short.

## ✨ Highlights

- 🔴 **Auto mode.** Claude picks its own gear for the work in front of it: medium, high, xhigh or max.
- ⚙️ **Clear shift rules.** Each gear has counted conditions (attempts, files, systems, steps), not vague feelings.
- 🎚️ **You set the difficulty.** Make max, xhigh or high harder or easier to reach, one step at a time.
- ⏱️ **Smooth shifting.** At least 60 seconds between changes, so the effort never flickers.
- 🛑 **Rev limiter on max.** Ten minutes in a row at most, then back to medium until your next prompt.
- 💰 **Budget aware.** When your weekly usage runs ahead of the week, every gear gets one step harder to reach.
- 👀 **Watch it live.** A chart in the pane shows the output tokens each gear spends, per 15 minutes, as you work.
- 🔒 **Local and free.** No model calls, no network requests.

## 🧭 How it works

1. **Beside every prompt**, the mod adds the effort rules and asks Claude to answer with one Bash call:

   ```bash
   echo "EFFORT=high"
   ```

2. **Claude picks the first level whose conditions match** the coming work:

   | Level | When (standard thresholds) |
   |---|---|
   | max | a design or architecture decision with real trade-offs; a failure still unexplained after 2 attempts; a change across 2 or more systems where a wrong fix is likely |
   | xhigh | the same kind of failure a 3rd time; a fix that did not hold; results that contradict expectations |
   | high | 3 or more files or components that must stay consistent; a procedure of 5 or more steps with checks |
   | medium | everything else: small fixes, reading, reporting, routine edits |

3. **The mod sends that level** on the next steps of the main conversation. When the work changes, Claude echoes a new
   level, and drops back as soon as the hard part ends.

The answer is free-standing: other words on the echo line are ignored, so the request can share a line with any other
check you already ask Claude to echo.

### 🛡️ Limits the mod applies

- **60 seconds between changes**, so the effort does not flicker.
- **Max for at most 10 minutes in a row**, then medium until your next prompt.
- **Weekly budget step:** when the rest of your week's usage limit pays for less than you are currently spending, every
  count in the rules goes one higher, so the higher levels need more reason. The budget never lowers an answer Claude
  already gave.
- **Subagent note:** over half of the week's limit, a call that starts a native subagent carries a note suggesting a
  lighter helper. It is never blocked.

### 🤖 Models

Opus, Fable and Sonnet 5 and later, from medium to max. Other models and subagent steps are left alone.

## 🎚️ You control your usage, and watch it live

Higher effort means more thinking, and more thinking means more tokens from your usage limit. adaptive-effort leaves
that trade-off in your hands:

- **You set how hard each gear is to reach.** Press **Harder** on Max, Extra high or High and Claude needs more reason
  to use it, so it spends less; press **Easier** and it climbs sooner when the work calls for it.
- **You see what it costs, as it happens.** The pane's chart and table update with every model call, so after a press
  you watch the next answers follow your new setting.
- **Your weekly limit is watched too.** When your usage runs ahead of the week, every gear gets one step harder on its
  own, and the pane says so in amber.

## 🎛️ The Thinking effort pane

The pane opens at session start (`/adaptive-effort pane` brings it to the front). It shows:

- the effort now, as a coloured pill, and one line on how Auto works;
- one card each for **Max**, **Extra high** and **High**, every condition on its own line with the counts in force,
  and **Easier** / **Harder** buttons;
- **Save as default** and **Reset to standard**;
- the live chart and table below.

### 📊 The live chart

- **Output tokens per 15 minutes, by effort.** One column per quarter hour, stacked by level, starting at the left.
  Output tokens (thinking included) are what the effort changes; the context Claude rereads costs the same at every
  level, so it is not counted.
- **A frame of fixed size.** The tallest column fills the height and 24 hours fit the width, so the chart never grows.
  The terminal gets text rows in place of the drawing.
- **A table of the levels used**, one row each: calls, output per call and share of all output. Levels not used are left
  out.
- **Kept for 24 hours, then deleted.** Each session's chart is saved in Claude Code's local plugin storage at most once
  a minute and when the session ends, so it comes back after an app restart. Older charts are deleted at the next
  session start, so the storage stays small.

Each step **Harder** raises that level's counts by one; **Easier** lowers them (from easier -2 to harder +3). Harder on
Max also makes a design decision count for max only when it spans that many systems. A change during a turn reaches
Claude at its next tool call.

## ⌨️ Commands

| Command | Does |
|---|---|
| `/adaptive-effort` | Shows the version, the effort, Claude's last answer, the thresholds, the limits and the weekly budget |
| `/adaptive-effort pane` | Opens or raises the pane |
| `/adaptive-effort max harder` | Makes a level harder or easier: `max`, `xhigh` or `high`, then `harder` or `easier` |
| `/adaptive-effort save` | Keeps the current thresholds as the default for new sessions |
| `/adaptive-effort reset` | Returns to the standard thresholds |
| `/adaptive-effort off` / `on` | Turns the mod off or on |

## 📦 Install

This is a Claude Code plugin with a hooks module (a mod). Plugin support and the mod API depend on your Claude Code
version; check the plugin documentation for your build.

1. Copy the `adaptive-effort` folder into a local plugin marketplace, or load it for one session with:

   ```bash
   claude --plugin-dir path/to/adaptive-effort
   ```

2. Generate the API types for your build (they are not stored in this repository) by running `/plugin-types` in a
   session, pointed at this folder.

## 🚀 First run, and after every update

Claude Code reads a plugin when a session starts. A session that was already open when you installed or updated
adaptive-effort keeps running the build it had, or none, until you reload it.

1. **Load it.** In the open session, run:

   ```text
   /reload-plugins
   ```

   or start a new session.

2. **Check the build.** Run `/adaptive-effort`. Its first line names the version this session loaded, for example
   `version 1.0.2 is on`. An older number, or no reply at all, means the session has not loaded this build yet: go
   back to step 1.

3. **Open the pane.** It opens by itself when a session starts. After a reload, or when it is hidden behind another
   pane, bring it to the front with:

   ```text
   /adaptive-effort pane
   ```

### 🧩 If something does not show

| You see | It means | Do this |
|---|---|---|
| `/adaptive-effort` is an unknown command | The session has not loaded the mod | Run `/reload-plugins` or start a new session; check the plugin is installed and enabled |
| `Thinking effort pane shown.` | The pane is open in front | Nothing to do |
| `Thinking effort pane is open behind another pane: click its "Thinking effort" tab.` | Another pane is in front of it | Click the **Thinking effort** tab |
| `the pane is not drawn here` | This surface draws no side pane | Use the commands below (`/adaptive-effort max harder`, `save`, `reset`); the terminal shows the chart as text rows |
| `No model calls yet since this build loaded.` | The chart has nothing to show yet | Keep working: the chart and table fill in after the next answer |
| An old version number in `/adaptive-effort` | The session still runs the old build | Run `/reload-plugins` |

## 🧪 Test

```bash
claude plugin validate path/to/adaptive-effort
claude plugin test path/to/adaptive-effort
```

The tests cover answer parsing, the hold and the max limit, the budget step, the pane and its buttons, saved defaults,
model ranges, the subagent note, and the chart: its buckets, the 24-hour deletion, the table, the fixed frame, and
keeping it across a restart and a plugin reload.

## 🔒 Privacy and cost

The mod makes no model calls and no network requests. It reads the usage limits and token counts Claude Code already
reports, and keeps its settings and each session's chart (for 24 hours) in Claude Code's local plugin storage.

## 📜 License

PolyForm Noncommercial 1.0.0, as the rest of this repository. See [LICENSE](../../LICENSE).
