# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A VS Code extension that adds play buttons to the editor title bar to run JavaScript/TypeScript files or selected code with a single click. Supports untitled/unsaved scratch files and automatically detects the Node.js version to choose the best TypeScript execution strategy (native TS, `--experimental-strip-types`, or `tsx` fallback).

## Build & Development Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Build the extension once (`tsdown`) |
| `npm run watch` | Build in watch mode |
| `npm run lint` | Lint and auto-fix with `oxlint --fix` |
| `npm run fmt` | Format with `oxfmt` |
| `npm run check` | Run lint + format check (CI gate) |
| `npm run pack` | Package extension as `.vsix` (`vsce package --no-dependencies`) |
| `npm run vscode:prepublish` | Pre-publish build step |

There is no test suite in this project.

## Architecture

The entire extension lives in a single file: `src/extension.ts`. It registers two commands (`runFile`, `runSelection`) and a task-end listener.

**Execution flow:**
1. Command handler resolves the active editor and validates the file extension against `JS_EXTENSIONS` (`.js`, `.mjs`, `.cjs`, `.node`) or `TS_EXTENSIONS` (`.ts`, `.mts`, `.cts`). Untitled files are mapped via `LANG_EXT_MAP` using the document's `languageId`.
2. For saved files, the document's real path is used. For untitled files or selections, content is written to a temp file under `os.tmpdir()/quick-run-js-ts/` via `writeTempFile()`.
3. `buildRunCommand()` selects the runtime:
   - JS files → `runtime` setting (default `node`).
   - TS files → native `node` if Node >= 23.6; `--experimental-strip-types` if >= 22.6; otherwise `tsFallbackCommand` (default `npx --yes tsx`).
   - Node version is detected once with `execSync('node -v')` and cached in `cachedNodeVersion`.
4. A `vscode.Task` with a `ShellExecution` is created and run in a shared terminal panel (`TaskPanelKind.Shared`).
5. When the task ends, `handleTaskEnd()` cleans up any temp files tracked in `pendingCleanup`.

**Selection handling (`collectSelectedLines`):**
- Iterates all non-empty selections.
- Collects every line number touched by each selection.
- If a selection ends exactly at the start of a line (`character === 0`), that end line is excluded.
- Lines are sorted and joined with newlines.

**Key constraints:**
- `vscode` is externalized and never bundled (`tsdown.config.ts` → `deps.neverBundle: ['vscode']`).
- Output format is ESM (`format: 'esm'`), platform `node`.
- Activation events: `onLanguage:javascript` and `onLanguage:typescript`.

## Extension Manifest (`package.json`)

- **Commands:** `quick-run-js-ts.runFile` (icon `$(play)`), `quick-run-js-ts.runSelection` (icon `$(run-below)`).
- **Menu placement:** Both appear in `editor/title` with `navigation` group at priorities `-9999` and `-9998`.
- **Settings:**
  - `quickRunJsTs.runtime` — runtime for JS and natively supported TS (default: `node`).
  - `quickRunJsTs.tsFallbackCommand` — fallback for TS when Node is too old (default: `npx --yes tsx`).

## Important Notes from README

- Node.js >= 23.6 runs TypeScript natively.
- Node.js >= 22.6 uses `--experimental-strip-types`.
- Older versions fall back to `tsx`.
- Untitled files and selections are written to temporary files, executed, and cleaned up automatically after the task ends.
