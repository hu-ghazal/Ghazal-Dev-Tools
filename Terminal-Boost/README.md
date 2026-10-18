# Terminal Boost

<p align="center">
  <img alt="Terminal Boost: a terminal over falling green code with a flashing prompt" src="assets/banner.svg" width="900">
</p>

**Finish what was asked, prove it with fresh evidence, and never call work done when it is not.**

Terminal Boost is a discipline for carrying any piece of work from the request to a verified close. It is domain
agnostic: software, operations, data, documents, analysis or design, done by a person, a team or an AI agent.

<p align="center">
  <img alt="Terminal Boost flow: hold the request's own words, declare the design and checks, do the work, run the checks fresh, test every claim against evidence, then close or name the gaps" src="assets/flow.svg" width="760">
</p>

## Why it exists

Whoever does the work, and whatever the field, the same failures keep coming back:

- **The task drifts.** An easier problem gets solved in place of the one asked, or the scope quietly widens.
- **"Done" is not done.** A report says the checks passed when they were never run, or ran on something else.
- **Old results stand in for new ones.** A check that passed yesterday is quoted after the work has changed.
- **Retries go blind.** A failing step is tried again and again, with nothing changed and no idea why it failed.
- **Claims outgrow the proof.** "Fixed", "verified" and "delivered" appear in the summary with nothing behind them.

Terminal Boost puts a fixed path in front of the work so each of these is caught at the step where it happens.

## The flow

| Stage | What happens | What it prevents |
|---|---|---|
| 1. **Hold the words** | The request is kept in the requester's own words, as the outcomes the work must meet, with the boundary of the work named | Drift, and an easier task replacing the real one |
| 2. **Declare first** | The intended design and the checks that will prove it are stated before any work starts | Proof invented after the fact to fit the result |
| 3. **Do the work** | The work is done inside its declared boundary | Unrelated changes slipping in beside the real one |
| 4. **Check fresh** | Every declared check runs again at the close, on the work as it is now | Stale or reported results counting as proof |
| 5. **Test the claims** | The closing report's own statements are held against what actually ran | Success, delivery or verification claims nothing supports |
| 6. **Close or name the gaps** | The work closes only when every outcome is met; otherwise each open gap is named | Partial work presented as finished |

A failed check may run again only with a stated cause and a stated change, so every retry is an experiment rather than
a hope. The rigour scales with the work: a small, clear job takes a light path, and complex work gets a stricter one.

## Where it applies

The same six stages fit any unit of work, at any size:

| Kind of work | What it is | What Terminal Boost holds it to |
|---|---|---|
| **A task** | One request with one result | The result matches the words of the request, checked at the close |
| **Agentic work** | An AI agent, or several, acting on a request with its own steps and tools | Every step stays inside the request, and the agent's "done" is proved, not reported |
| **A workflow** | A set of steps or roles that hand work to each other | Each hand-off carries what was asked and what was proved, so nothing is lost or invented between steps |
| **A pipeline** | An end-to-end process, from the first input to the delivered output | The delivered output is checked against the original request, not only each stage on its own |
| **A project** | Many tasks toward one goal | Each piece closes on its own evidence, and open gaps stay visible until they are closed |

## Who it is for

- **Anyone who hands work to someone else** (a colleague, a contractor, an AI agent) and needs to trust the word "done".
- **Teams whose results are checked by others:** clients, auditors, reviewers, regulators.
- **Work where a wrong "finished" is expensive:** production systems, money, safety, legal or client delivery.

## Before and after

The same request, closed twice.

| | Without Terminal Boost | With Terminal Boost |
|---|---|---|
| **A software fix** | "Fixed, all tests pass." The tests ran before the last change, and one of the three reported cases was never touched. | The close lists the three cases from the request, the checks run just now on the final version, and names the one case still open. |
| **A monthly report** | "Report ready." The figures came from last month's extract, and the section the manager asked for is missing. | The close shows the requested sections, the figures re-checked against today's source, and the one source that could not be reached. |
| **A system change** | "Migration done." The data was copied, but nobody compared it afterwards. | The close shows the counts and samples compared after the copy, and a rollback named before the change began. |
| **An AI agent's task** | "All done!" The agent changed four files, two of them outside the request, and never ran the checks it described. | The close shows the work stayed inside the request, the checks ran on the final result, and the one claim without proof is withdrawn. |
| **A workflow hand-off** | The reviewer passes the draft on as "approved", but reviewed an earlier version. | The hand-off carries which version was checked and against what; the next step starts from the version that was actually reviewed. |
| **A data pipeline** | Every stage reports success, but the final dashboard shows last week's numbers. | The end-to-end check compares the delivered output with the source of today, and names the stage where the data went stale. |

## What you get

- **Answers you can trust.** A closed piece of work means its checks ran and passed at the close.
- **Visible gaps.** What is not finished is named, not hidden in a confident summary.
- **Less waste.** No blind retries and no work redone because the first attempt solved the wrong problem.
- **Any field, any worker.** People, teams, AI agents, workflows and pipelines follow the same path.

## Questions

**Does it replace testing, review or audit?** No. It makes sure they actually happen, at the right moment, on the
right version, and that the summary says only what they showed.

**Does it need special software?** No. It is a discipline first: it fits any tool, any team and any AI agent.

**Is it slow?** A small, clear job takes a light path. The stricter path is kept for work where a mistake costs more.

**What does a piece of work need?** A request someone can quote, and at least one thing that can be checked.

## Copyright

Copyright (c) 2026 [hu-ghazal](https://github.com/hu-ghazal). Covered by the repository's
[PolyForm Noncommercial License 1.0.0](../LICENSE).
