# Ghazal-Dev-Tools

Skills, mods and MCP servers that give AI coding agents like Claude Code and Codex more control, more features and
easier handling.

Welcome! This is an open workshop for people who build with AI coding agents. Every tool here started as a fix for a
real problem in daily work: an agent that forgot what it was told, guessed instead of checking, spent effort where it
was not needed, or reported work as done when it was not. Use what helps you, improve it, and share back.

## What is inside

Every tool has its own folder at the top of the repository, with a README that says what it does, how to install it
and how to test it. A tool is one of these kinds:

| Kind | What it is |
|---|---|
| Skill | A written procedure an agent loads and follows for a kind of task |
| Mod | A plugin that changes how the agent works: hooks, panes, status lines, commands |
| MCP server | A server that gives an agent new tools |
| Concept | A method described with its flow, with no code published |

### Tools

| Tool | Kind | What it does |
|---|---|---|
| 🏎️ [adaptive-effort](adaptive-effort) | Claude Code mod | An automatic gearbox for Claude's thinking: Claude shifts its own reasoning effort by clear rules, and a pane makes each gear harder or easier to reach |
| 🟩 [Terminal Boost](Terminal-Boost) | Concept | Finish what was asked and prove it with fresh evidence: the request held in its own words, checks declared first and run fresh at the close, every claim tested against what ran |

## Getting started

1. Clone the repository.
2. Open the README of the tool you want.
3. Follow its install steps. Most tools work on their own; a tool that needs another one says so.

## Join in

Everyone is welcome: first-time contributors, daily agent users and tool builders alike.

- **Try a tool and tell us how it went.** Open an issue with what worked, what did not, and your agent and system.
- **Report a bug.** Say what you did, what you expected and what happened instead.
- **Suggest an idea.** Open an issue describing the problem it solves.
- **Send a change.** Fork the repository, make your change on a branch, add or update its tests, and open a pull
  request that says what it changes and why. See [CONTRIBUTING.md](CONTRIBUTING.md) for the steps and terms.

Please keep tools self-contained, free of personal paths, keys and machine-specific settings, and tested before you
send them. Be kind and constructive in issues and reviews.

## License

Copyright (c) 2026 hu-ghazal (https://github.com/hu-ghazal). All rights reserved except as granted in [LICENSE](LICENSE).

This project is free for **noncommercial** use under the **PolyForm Noncommercial License 1.0.0**:

- **You may** use, copy, change and share these tools for personal, research, education, hobby and other
  noncommercial purposes.
- **You may not** sell these tools, or use them in a product or service you sell, without written permission from
  the copyright holder.
- **Keep the credit.** Copies and changed versions must keep the copyright notice and the license.

For commercial use, contact the copyright holder to agree a license.

By sending a contribution, you agree to the terms in [CONTRIBUTING.md](CONTRIBUTING.md): it is shared under the same
license, and the copyright holder may also include it under a commercial license.
