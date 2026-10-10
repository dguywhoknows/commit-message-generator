# commit-message-generator

[![tests](https://github.com/dguywhoknows/commit-message-generator/actions/workflows/tests.yml/badge.svg)](https://github.com/dguywhoknows/commit-message-generator/actions/workflows/tests.yml)

Paste a git diff to get a Conventional Commit message, a PR description and an AI code review, plus a linter for the message itself.

Live: https://dguywhoknows.github.io/commit-message-generator/

## Overview

Commit Crafter parses unified diffs: added, deleted and renamed files, hunks, line numbers, binary files. It renders them as a collapsible diff viewer with per-file change bars. Local heuristics guess the commit type (docs, test, ci, build, style for whitespace-only changes, fix, refactor, perf, feat) and a scope from the common directory. The AI then writes the message in Conventional Commits, Gitmoji or plain style, drafts a PR description, and reviews the changed lines with file:line comments. A live linter checks the message against the usual rules.

## Pages

- **Compose**
- **Split**
- **Changelog**
- **Conventions**
- **History**
- **Settings**

## Features

- Unified diff parser: new/deleted/renamed files, hunks, old/new line numbers, binary detection
- Collapsible diff viewer with add/delete stats and change bars
- Local commit-type + scope inference (whitespace-only → style, lockfiles → build, tests → test …)
- AI commit messages in Conventional Commits / Gitmoji / plain style, with optional 'why' context
- Live message linter: 72-col subject/body, imperative mood, conventional prefix, blank line, specificity
- AI PR description (Summary, Changes, How to test, Risks, Checklist)
- AI code review with severity, file:line and suggested fixes
- Token-budgeted diff packing (lockfiles omitted, docs/deps last)
- Pre-commit checks on added lines: likely secrets (AWS keys, private keys, tokens, hard-coded passwords), committed .env/key files, merge-conflict markers, debug statements, focused tests and new TODOs
- Split page: groups a large diff into focused commits (tests travel with the code they cover; docs, dependencies and CI separate), writes a message per group, and produces a ready-to-run git add / git commit script
- Changelog page: turns git log output into a Keep a Changelog entry, detects breaking changes, suggests the semver bump and next version, and drafts user-facing release notes
- Conventions page: team rules for types, scopes, subject length, body width, required scope and issue references; the linter applies them live and exports commitlint.config.js and a .gitmessage template
- History page: save, search, copy and re-edit past messages
- Body re-wrapping that keeps bullet indentation and leaves URLs intact

## How it works

LLM calls are used for:

- Commit message generation guided by local type/scope heuristics
- PR description generation
- Structured code review (JSON) over the changed lines

Everything else (diff parsing, viewer, type/scope heuristics, linting, prompt packing, git command builder) runs locally in the browser.

## Getting started

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/dguywhoknows/commit-message-generator.git
cd commit-message-generator
python -m http.server 8000
```

Then open http://localhost:8000.

`index.html` is the public home page, `login.html` handles accounts and `app.html` is the app.

### Telling the app what to do

Every page has an **Ask AI** box (Ctrl/Cmd+K). Type a request in plain words and the model plans a sequence of
calls to the app's own functions, runs them and reports back. The **Instructions** tab stores standing
preferences that are added to every AI request the app makes.

### Configuration

`src/lib/config.js` is generated from the build settings: the Supabase project (accounts) and the AI proxy URL.
Signed-in users get the built-in AI through the proxy, which keeps the provider key as a server-side secret.
Without those settings the app runs for guests, in demo mode, or with a personal [Groq](https://console.groq.com/keys)
or [OpenRouter](https://openrouter.ai/keys) key entered under **Settings → Model provider** (stored only in this
browser and sent only to that provider).

## Testing

`src/core.js` holds the app's logic as pure functions and is covered by 12 unit tests.

```bash
node tests/run-node.js        # CI runs this on every push
```

Or open `tests/index.html` in a browser ([live](https://dguywhoknows.github.io/commit-message-generator/tests/)).

## Project structure

```
index.html           public home page (generated)
login.html           sign-in and sign-up (generated)
app.html             the app: markup for every page
src/app.js           UI, page wiring and event handlers
src/core.js          pure logic with no DOM access (unit-tested)
src/demo.js          sample responses used when no API key is configured
src/lib/ai.js        LLM client: Groq / OpenRouter, streaming, JSON mode, retries
src/lib/dom.js       DOM helpers, namespaced storage, markdown renderer
src/lib/router.js    hash router and the Settings page
src/lib/copilot.js   AI command box that drives the app's own functions
src/lib/auth.js      accounts (Supabase Auth) and the sign-in gate
styles/base.css      design tokens and shared components
styles/app.css       app-specific styles
tests/               unit tests (browser runner + Node runner for CI)
```

## Tech

- Unified diff format parser
- Unicode property escapes for emoji-aware linting
- Prompt budgeting for large diffs
- Diff parsing, classification, linting, checks, splitting and changelog logic in src/core.js covered by unit tests run in the browser and in CI
- Vanilla JavaScript, no framework or bundler
- Deployed with GitHub Pages

## License

MIT
