# adaptive-effort

A Claude Code mod that lets Claude choose its own reasoning effort, step by step, by clear rules you control.

Claude spends more thinking on hard work and less on easy work. You decide how hard each level is to reach, from a
side pane, and the mod keeps the switching calm and the expensive levels short.

## How it works

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

### Limits the mod applies

- **60 seconds between changes**, so the effort does not flicker.
- **Max for at most 10 minutes in a row**, then medium until your next prompt.
- **Weekly budget step:** when the rest of your week's usage limit pays for less than you are currently spending, every
  count in the rules goes one higher, so the higher levels need more reason. The budget never lowers an answer Claude
  already gave.
- **Subagent note:** over half of the week's limit, a call that starts a native subagent carries a note suggesting a
  lighter helper. It is never blocked.

### Models

Opus, Fable and Sonnet 5 and later, from medium to max. Other models and subagent steps are left alone.

## The Thinking effort pane

The pane opens at session start (`/adaptive-effort pane` brings it to the front). It shows:

- the effort now;
- one block each for **Max**, **Extra high** and **High**, every condition on its own line with the counts in force,
  and **Easier** / **Harder** buttons;
- **Save as default** and **Reset to standard**.

Each step **Harder** raises that level's counts by one; **Easier** lowers them (from easier -2 to harder +3). Harder on
Max also makes a design decision count for max only when it spans that many systems. A change during a turn reaches
Claude at its next tool call.

## Commands

| Command | Does |
|---|---|
| `/adaptive-effort` | Shows the effort, Claude's last answer, the thresholds, the limits and the weekly budget |
| `/adaptive-effort pane` | Opens or raises the pane |
| `/adaptive-effort max harder` | Makes a level harder or easier: `max`, `xhigh` or `high`, then `harder` or `easier` |
| `/adaptive-effort save` | Keeps the current thresholds as the default for new sessions |
| `/adaptive-effort reset` | Returns to the standard thresholds |
| `/adaptive-effort off` / `on` | Turns the mod off or on |

## Install

This is a Claude Code plugin with a hooks module (a mod). Plugin support and the mod API depend on your Claude Code
version; check the plugin documentation for your build.

1. Copy the `adaptive-effort` folder into a local plugin marketplace, or load it for one session with:

   ```bash
   claude --plugin-dir path/to/adaptive-effort
   ```

2. Generate the API types for your build (they are not stored in this repository) by running `/plugin-types` in a
   session, pointed at this folder.

## Test

```bash
claude plugin validate path/to/adaptive-effort
claude plugin test path/to/adaptive-effort
```

The tests cover answer parsing, the hold and the max limit, the budget step, the pane and its buttons, saved defaults,
model ranges and the subagent note.

## Privacy and cost

The mod makes no model calls and no network requests. It reads the usage limits Claude Code already reports, and keeps
its settings in Claude Code's local plugin storage.

## License

PolyForm Noncommercial 1.0.0, as the rest of this repository. See [LICENSE](../../LICENSE).
