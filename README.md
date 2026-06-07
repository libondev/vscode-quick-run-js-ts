# Quick Run JS/TS

[简体中文](./README.zh-CN.md)

A VS Code extension that lets you run JavaScript and TypeScript files or selected code with a single click, including unsaved scratch files. It automatically detects your Node.js version and uses native TypeScript support when available.

## Features

- One-click execution via the play button in the editor title bar
- Run the whole file or only the selected lines
- **Untitled file support** - run unsaved JavaScript/TypeScript scratch files without saving first
- **Smart debug support** - automatically runs with the VS Code debugger when breakpoints are set
- Automatic Node.js version detection:
  - **Node.js >= 23.6**: Runs TypeScript files natively
  - **Node.js >= 22.6**: Uses `--experimental-strip-types` flag
  - **Older versions**: Falls back to `tsx` (configurable)
- Supports `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts` files
- Output displayed in a dedicated terminal panel

## Installation

Install from the VS Code Marketplace by searching for **Quick Run JS/TS**, or install via the command line:

```bash
code --install-extension banlify.quick-run-js-ts
```

## Usage

### Run A File

1. Open a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, or `.cts` file.
2. Click **Quick Run JS/TS: Run** from the editor title bar.
3. The file runs in a shared terminal panel.

You can also create an untitled editor, set the language mode to JavaScript or TypeScript, and run it before saving.

### Run Selected Code

1. Select one or more lines in a JavaScript or TypeScript editor.
2. Click **Quick Run JS/TS: Run Selection** from the editor title bar.
3. The selected lines are copied to a temporary file and executed.

> **Tip:** Untitled files and selections are written to temporary files, executed, and cleaned up automatically after the task ends.

### Debug Mode

The extension can automatically run saved files with the VS Code debugger.

- **`auto` (default)** - debugs only when breakpoints are set in the file
- **`always`** - always runs saved files in debug mode
- **`never`** - always runs as tasks

Set it via `quickRunJsTs.debugMode` in VS Code settings.

> Debug mode only applies to saved files. Untitled files and selections always run as tasks.

### TypeScript Runtime Behavior

Quick Run JS/TS chooses the TypeScript command based on your installed Node.js version:

- **Node.js >= 23.6**: `node <file>`
- **Node.js >= 22.6**: `node --experimental-strip-types <file>`
- **Older Node.js versions**: `npx --yes tsx <file>` by default

## Configuration

| Setting                          | Default         | Description                                                                                                                 |
| -------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `quickRunJsTs.runtime`           | `node`          | Runtime command used to execute JS files and supported TS files. You can set it to another runtime such as `bun` or `deno`. |
| `quickRunJsTs.tsFallbackCommand` | `npx --yes tsx` | Fallback command for TS files when native support is unavailable                                                            |
| `quickRunJsTs.debugMode`         | `auto`          | When to run saved files with the VS Code debugger: `auto` = when breakpoints are set, `always` = always, `never` = never    |
