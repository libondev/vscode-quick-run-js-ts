import type {
  ExtensionContext,
  TaskDefinition,
  TaskEndEvent,
  TextDocument,
  TextEditor,
} from 'vscode'
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
  ShellExecution,
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

interface QuickRunTaskDefinition extends TaskDefinition {
  type: typeof TASK_TYPE
  filePath: string
}

// ---------------------------------------------------------------------------
// Node.js version detection
// ---------------------------------------------------------------------------

let cachedNodeVersion: number[] | null = null

function resolveNodeVersion(): number[] {
  try {
    const output = execSync('node -v', { encoding: 'utf-8', timeout: 1000 }).trim()
    const match = output.match(/v(\d+)\.(\d+)\.(\d+)/)
    if (match) {
      const version = [Number(match[1]), Number(match[2]), Number(match[3])]
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

  const [cachedMajor, cachedMinor] = cachedNodeVersion
  return cachedMajor > major || (cachedMajor === major && cachedMinor >= minor)
}

export function isNode(runtime: string): boolean {
  const base = basename(runtime)
  return base === 'node' || base === 'node.exe'
}

// ---------------------------------------------------------------------------
// Temp file management
// ---------------------------------------------------------------------------

export const pendingCleanup = new Set<string>()

export function writeTempFile(ext: string, content: string): string {
  const tmpDir = join(tmpdir(), 'quick-run-js-ts')
  mkdirSync(tmpDir, { recursive: true })
  const filePath = join(tmpDir, `snippet-${randomUUID()}${ext}`)
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

interface RunContext {
  editor: TextEditor
  document: TextDocument
  ext: string
}

export function resolveExtension(document: TextDocument): string | null {
  return LANG_EXT_MAP[document.languageId] || extname(document.fileName).toLowerCase() || null
}

export function isSupportedExtension(ext: string): boolean {
  return JS_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext)
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

export function resolveTsCommand(ext: string, runtime: string): string {
  if (JS_EXTENSIONS.has(ext) || !isNode(runtime)) {
    return runtime
  }

  if (isNodeVersionGte(23, 6)) {
    return runtime
  }
  if (isNodeVersionGte(22, 6)) {
    return `${runtime} --experimental-strip-types`
  }

  const config = workspace.getConfiguration(CONFIG_SECTION)
  return config.get<string>('tsFallbackCommand', 'npx --yes tsx')
}

function buildRunCommand(filePath: string, ext: string): string {
  const config = workspace.getConfiguration(CONFIG_SECTION)
  const nodeCmd = config.get<string>('runtime', 'node')
  const cmd = resolveTsCommand(ext, nodeCmd)
  return `${cmd} ${JSON.stringify(filePath)}`
}

function runFile(filePath: string, ext: string, isTemp: boolean) {
  const definition: QuickRunTaskDefinition = { type: TASK_TYPE, filePath }
  const task = new Task(
    definition,
    TaskScope.Workspace,
    'Run JS/TS',
    TASK_TYPE,
    new ShellExecution(buildRunCommand(filePath, ext)),
  )
  task.presentationOptions = {
    reveal: TaskRevealKind.Always,
    panel: TaskPanelKind.Shared,
    focus: true,
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
  const nodeCmd = config.get<string>('runtime', 'node')
  const cmd = resolveTsCommand(ext, nodeCmd)
  const parts = cmd.split(/\s+/)

  debug.startDebugging(undefined, {
    type: 'node',
    request: 'launch',
    name: 'Quick Run JS/TS',
    program: filePath,
    runtimeExecutable: parts[0],
    runtimeArgs: parts.slice(1),
    console: 'integratedTerminal',
  })
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function hasBreakpoints(filePath: string): boolean {
  return debug.breakpoints.some((bp) => {
    if (bp instanceof SourceBreakpoint) {
      return bp.location.uri.fsPath === filePath
    }
    return false
  })
}

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
  return hasBreakpoints(document.fileName)
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

  const { filePath } = definition as QuickRunTaskDefinition
  if (filePath && pendingCleanup.has(filePath)) {
    cleanupTempFile(filePath)
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

  // Eagerly detect and cache the Node.js version
  cachedNodeVersion = resolveNodeVersion()
}

export function deactivate() {
  try {
    for (const filePath of pendingCleanup) {
      unlinkSync(filePath)
    }
  } catch {}

  pendingCleanup.clear()
  outputChannel?.dispose()
}
