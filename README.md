# Quick Run JS/TS

A VS Code extension that lets you run JavaScript and TypeScript files with a single click, including unsaved scratch files. Automatically detects your Node.js version and uses native TypeScript support when available.

## Features

- One-click execution via the play button in the editor title bar
- **Untitled file support** — run unsaved JavaScript/TypeScript scratch files without saving first
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

1. Open a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, or `.cts` file (or create an untitled file and set the language to JavaScript/TypeScript)
2. Click the play button in the editor title bar
3. The file runs in a terminal panel

> **Tip:** For untitled files, the content is written to a temporary file, executed, and cleaned up automatically.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `quickRunJsTs.nodeCommand` | `node` | Node.js runtime command used to execute JS/TS files |
| `quickRunJsTs.tsFallbackCommand` | `npx --yes tsx` | Fallback command for TS files when native support is unavailable |

## Development

### Prerequisites

- Node.js >= 22.18.0 (required by tsdown at build time)

### Commands

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Watch mode for development
npm run watch

# Lint with oxlint
npm run lint

# Format with oxfmt
npm run format

# Run lint + format check
npm run check

# Package for publishing
npm run package
```

### Project Structure

```
├── src/
│   └── extension.ts    # Extension entry point
├── playground/         # Sample JS/TS files for testing
├── tsconfig.json       # TypeScript configuration
├── tsdown.config.ts    # tsdown bundler configuration
├── .oxlintrc.json      # oxlint linter configuration
├── .oxfmtrc.json       # oxfmt formatter configuration
└── package.json        # Extension manifest
```

## License

[MIT](https://github.com/libondev/quick-run-js-ts/blob/main/LICENSE)
