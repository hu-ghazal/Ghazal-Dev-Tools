# Changelog

All notable changes to adaptive-effort. Versions follow [Semantic Versioning](https://semver.org): a new major version
changes behaviour you rely on, a minor version adds features, a patch fixes bugs.

## 1.1.0 (2026-10-16)

Claude weighs the cost before it picks a level.

- Beside every prompt, the line now shows your weekly usage (used, left, hours left, allowed per day against spent per
  day) and this session's calls and output tokens of the last hour, by level.
- One cost rule for the pace you are on: faster than the week allows, the lower level when two fit; close to the pace,
  the level the conditions name; with room, a higher level the conditions support is affordable. Usage never raises a
  level the conditions do not support.
- Generic project signals: no tests, production, security or payment code, a shared or public repository, or unread
  code raise the answer one level, never to max on these alone.
- Every condition now comes in a version for code work and one for any other work, in specific, countable words.
- A **Settings** button beside "Effort now" lets you rewrite each condition (`{n}` for the count) and reset them to
  the defaults; your texts are saved for every session. The level cards no longer print the conditions: each shows a
  short definition of its level, and your setting only when you changed it. "Standard" now reads "default".
- Where several levels fit, Claude chooses among them by the work and the usage; the pace gives a lean, not an order.
- The recent spending rate is steadier: a weekly figure that has not moved yet no longer reads as zero spending, and a
  single step no longer reads as a burst.
- Tests: the usage figures and the lean per pace, the last hour's output by level, the line beside the prompt, both
  versions of every condition with the counts in force, saved definitions read back only in their shape, Settings
  saving, keeping and resetting definitions, and the rate from rises of the weekly figure.

## 1.0.2 (2026-10-16)

Watch your usage live in the pane.

- A chart of output tokens per 15 minutes, stacked by effort level, in a frame of fixed size that fits 24 hours.
- A table of the levels used: calls, output per call and share of all output.
- Each session's chart is kept for 24 hours in local plugin storage, saved at most once a minute and at session end,
  so it comes back after an app restart; a plugin reload keeps every call. Older charts are deleted.
- The pane is easier to read: the effort as a coloured pill, one card per level, grey text and the budget warning in
  amber.
- Tests: the chart's buckets, deletion, table, frame and drawing, and the restart and reload paths.

## 1.0.1 (2026-10-16)

Fixes to the 10-minute max limit.

- A max answer spent by its 10 minutes now stays medium on the next prompt. Before, a new prompt sent max again for
  another 10 minutes. Claude has to answer max again to get it back.
- A max run that ran out while the session sat idle no longer blocks a new max answer.
- `/adaptive-effort` names the loaded version, so each session shows which build it runs.
- Tests: seven stories for the max limit and the version line, plus a seeded random sweep of 6,000 events that checks
  the rules after every step.

## 1.0.0 (2026-10-15)

First public release.

- Claude picks its own reasoning effort (medium, high, xhigh, max) by counted rules and answers with
  `echo "EFFORT=<level>"`; the mod sends that level on the next steps.
- Thinking effort pane: make max, xhigh or high harder or easier to reach (from easier -2 to harder +3), save as
  default, reset to standard.
- Limits: 60 seconds between changes; max for at most 10 minutes, then medium until the next prompt.
- Weekly budget step: over budget, every count in the rules is one higher.
- Subagent note past half of the weekly limit.
- Opus, Fable and Sonnet 5 and later range from medium to max.
- No model calls and no network requests.
