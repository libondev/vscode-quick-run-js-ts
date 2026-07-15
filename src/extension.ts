import type { ExtensionContext, TaskEndEvent, TextDocument, TextEditor } from 'vscode'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import {
  commands,
  debug,
  tasks,
  window,
  workspace,
  OutputChannel,
  Task,
  TaskScope,
  ProcessExecution,
  TaskRevealKind,
  TaskPanelKind,
  SourceBreakpoint,
} from 'vscode'

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

let outputChannel: OutputChannel

function log(message: string) {
  if (!outputChannel) {
    return
  }

  const timestamp = new Date().toISOString().slice(11, 23)
  outputChannel.appendLine(`[${timestamp}] ${message}`)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_TYPE = 'quick-run-js-ts'
const CONFIG_SECTION = 'quickRunJsTs'

export const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.node'])
export const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])

export const LANG_EXT_MAP: Record<string, string> = {
  javascript: '.js',
  typescript: '.ts',
}

// ---------------------------------------------------------------------------
// Node.js version detection
// ---------------------------------------------------------------------------

let cachedNodeVersion: number[] | null = null

function resolveNodeVersion(): number[] {
  try {
    const output = execSync('node -v', { encoding: 'utf-8', timeout: 1000 }).trim()
    const match = output.match(/^v(\d+)\.(\d+)\.(\d+)/)
    if (match) {
      const version = [Number(match[1]), Number(match[2]), Number(match[3])]
      log(`Detected Node.js version: ${version.join('.')}`)
      return version
    }
    log(`Failed to parse Node.js version from output: "${output}"`)
  } catch (err) {
    log(`Failed to detect Node.js version: ${err}`)
  }

  return [0, 0, 0]
}

export function isNodeVersionGte(major: number, minor: number): boolean {
  if (!cachedNodeVersion) {
    cachedNodeVersion = resolveNodeVersion()
  }

  const [currentMajor, currentMinor] = cachedNodeVersion
  return currentMajor > major || (currentMajor === major && currentMinor >= minor)
}

export function isNode(runtime: string): boolean {
  const base = basename(parseCommand(runtime).executable)
  return base === 'node' || base === 'node.exe'
}

// ---------------------------------------------------------------------------
// Temp file management
// ---------------------------------------------------------------------------

const tempDir = join(tmpdir(), 'quick-run-js-ts')

export const pendingCleanup = new Set<string>()

export function writeTempFile(ext: string, content: string): string {
  mkdirSync(tempDir, { recursive: true })
  const filePath = join(tempDir, `snippet-${randomUUID()}${ext}`)
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

export function cleanupTempFile(filePath: string) {
  try {
    unlinkSync(filePath)
  } catch (err) {
    log(`Failed to clean up temp file ${filePath}: ${err}`)
  } finally {
    pendingCleanup.delete(filePath)
  }
}

// ---------------------------------------------------------------------------
// Editor / document helpers
// ---------------------------------------------------------------------------

export function resolveExtension(document: TextDocument): string | null {
  return LANG_EXT_MAP[document.languageId] || extname(document.fileName).toLowerCase() || null
}

export function isSupportedExtension(ext: string): boolean {
  return JS_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext)
}

interface RunContext {
  editor: TextEditor
  document: TextDocument
  ext: string
}

/**
 * Returns the active editor along with its resolved extension, or `null` when
 * there is no editor or the file type is not runnable (warning is shown).
 */
export function getRunContext(): RunContext | null {
  const editor = window.activeTextEditor
  if (!editor) {
    return null
  }

  const document = editor.document
  const ext = resolveExtension(document)
  if (!ext || !isSupportedExtension(ext)) {
    log(`Unsupported file type: "${ext}" (${document.fileName})`)
    window.showWarningMessage('Unsupported file type')
    return null
  }

  return { editor, document, ext }
}

/** Concatenates the full text of every line touched by a non-empty selection. */
export function collectSelectedLines(editor: TextEditor): string {
  const { document } = editor
  const lineNumbers = new Set<number>()

  for (const selection of editor.selections) {
    // A bare cursor (empty selection) selects nothing, so skip it.
    if (selection.isEmpty) {
      continue
    }

    let endLine = selection.end.line
    // A selection ending at the start of a line doesn't actually cover that line.
    if (selection.end.character === 0 && endLine > selection.start.line) {
      endLine -= 1
    }
    for (let line = selection.start.line; line <= endLine; line++) {
      lineNumbers.add(line)
    }
  }

  return [...lineNumbers]
    .toSorted((a, b) => a - b)
    .map((line) => document.lineAt(line).text)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

interface RunCommand {
  executable: string
  args: string[]
}

export function parseCommand(command: string): RunCommand {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (const char of command.trim()) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char
      continue
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    parts.push(current)
  }

  return { executable: parts[0] ?? '', args: parts.slice(1) }
}

export function resolveTsCommand(ext: string, runtime: string): RunCommand {
  const runtimeCommand = parseCommand(runtime)

  if (JS_EXTENSIONS.has(ext) || !isNode(runtime)) {
    return runtimeCommand
  }

  if (isNodeVersionGte(23, 6)) {
    return runtimeCommand
  }
  if (isNodeVersionGte(22, 6)) {
    return { ...runtimeCommand, args: [...runtimeCommand.args, '--experimental-strip-types'] }
  }

  const config = workspace.getConfiguration(CONFIG_SECTION)
  const fallback = config.get<string>('tsFallbackCommand', 'npx --yes tsx')
  return parseCommand(fallback)
}

function runFile(filePath: string, ext: string, isTemp: boolean) {
  const config = workspace.getConfiguration(CONFIG_SECTION)
  const runtime = config.get<string>('runtime', 'node')
  const cmd = resolveTsCommand(ext, runtime)

  const definition = { type: TASK_TYPE, filePath }
  const task = new Task(
    definition,
    TaskScope.Workspace,
    'Run JS/TS',
    TASK_TYPE,
    new ProcessExecution(cmd.executable, [...cmd.args, filePath]),
  )
  task.presentationOptions = {
    reveal: TaskRevealKind.Always,
    panel: TaskPanelKind.Shared,
    focus: true,
    clear: true,
  }

  if (isTemp) {
    pendingCleanup.add(filePath)
  }

  tasks.executeTask(task)
}

// ---------------------------------------------------------------------------
// Debug execution
// ---------------------------------------------------------------------------

function runWithDebug(filePath: string, ext: string) {
  const config = workspace.getConfiguration(CONFIG_SECTION)
  const runtime = config.get<string>('runtime', 'node')
  const cmd = resolveTsCommand(ext, runtime)

  debug.startDebugging(undefined, {
    type: 'node',
    request: 'launch',
    name: 'Quick Run JS/TS',
    program: filePath,
    runtimeExecutable: cmd.executable,
    runtimeArgs: cmd.args,
    console: 'integratedTerminal',
  })
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export function wantsDebug(document: TextDocument): boolean {
  const config = workspace.getConfiguration(CONFIG_SECTION)
  const mode = config.get<string>('debugMode', 'auto')

  if (mode === 'never') {
    return false
  }
  if (mode === 'always') {
    return true
  }

  // auto mode
  if (document.isUntitled) {
    return false
  }

  return debug.breakpoints.some((bp) => {
    if (bp instanceof SourceBreakpoint) {
      return bp.location.uri.fsPath === document.fileName
    }
    return false
  })
}

function handleRunFile() {
  const ctx = getRunContext()
  if (!ctx) {
    return
  }

  const { document, ext } = ctx

  if (document.isUntitled) {
    if (wantsDebug(document)) {
      window.showWarningMessage(
        'Debug mode is not available for untitled files. Please save the file first.',
      )
    }
    runFile(writeTempFile(ext, document.getText()), ext, true)
  } else if (wantsDebug(document)) {
    runWithDebug(document.fileName, ext)
  } else {
    runFile(document.fileName, ext, false)
  }
}

function handleRunSelection() {
  const ctx = getRunContext()
  if (!ctx) {
    return
  }

  const content = collectSelectedLines(ctx.editor)
  if (!content.trim()) {
    window.showWarningMessage('No content selected to run')
    return
  }

  if (wantsDebug(ctx.document)) {
    window.showWarningMessage('Debug mode is not available for running selections.')
  }

  runFile(writeTempFile(ctx.ext, content), ctx.ext, true)
}

function handleTaskEnd(event: TaskEndEvent) {
  const { definition } = event.execution.task
  if (definition.type !== TASK_TYPE) {
    return
  }

  if (definition.filePath && pendingCleanup.has(definition.filePath)) {
    cleanupTempFile(definition.filePath)
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export const activate = (context: ExtensionContext) => {
  outputChannel = window.createOutputChannel('Quick Run JS/TS')
  context.subscriptions.push(outputChannel)

  context.subscriptions.push(
    commands.registerCommand('quick-run-js-ts.runFile', handleRunFile),
    commands.registerCommand('quick-run-js-ts.runSelection', handleRunSelection),
    tasks.onDidEndTask(handleTaskEnd),
  )
}

export function deactivate() {
  for (const filePath of pendingCleanup) {
    cleanupTempFile(filePath)
  }

  outputChannel?.dispose()
}
