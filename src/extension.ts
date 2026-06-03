import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_TYPE = 'quick-run-js-ts'
const CONFIG_SECTION = 'quickRunJsTs'

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.node'])
const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])

const LANG_EXT_MAP: Record<string, string> = {
  javascript: '.js',
  typescript: '.ts',
}

interface QuickRunTaskDefinition extends vscode.TaskDefinition {
  filePath: string
}

// ---------------------------------------------------------------------------
// Node.js version detection
// ---------------------------------------------------------------------------

let cachedNodeVersion: number[] | null = null

function getNodeVersion(): number[] {
  if (cachedNodeVersion) {
    return cachedNodeVersion
  }

  try {
    const output = execSync('node -v', { encoding: 'utf-8', timeout: 5000 }).trim()
    const match = output.match(/v(\d+)\.(\d+)\.(\d+)/)
    if (match) {
      cachedNodeVersion = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
      return cachedNodeVersion
    }
  } catch {}

  return [0, 0, 0]
}

function isVersionGte(major: number, minor: number): boolean {
  const [M, m] = getNodeVersion()
  return M > major || (M === major && m >= minor)
}

// ---------------------------------------------------------------------------
// Temp file management
// ---------------------------------------------------------------------------

const pendingCleanup = new Set<string>()

function writeTempFile(ext: string, content: string): string {
  const tmpDir = path.join(os.tmpdir(), 'quick-run-js-ts')
  fs.mkdirSync(tmpDir, { recursive: true })
  const filePath = path.join(tmpDir, `snippet-${Date.now()}${ext}`)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

function cleanupTempFile(filePath: string) {
  try {
    fs.unlinkSync(filePath)
  } finally {
    pendingCleanup.delete(filePath)
  }
}

// ---------------------------------------------------------------------------
// Editor / document helpers
// ---------------------------------------------------------------------------

interface RunContext {
  editor: vscode.TextEditor
  document: vscode.TextDocument
  ext: string
}

function resolveExtension(document: vscode.TextDocument): string | null {
  if (document.isUntitled) {
    return LANG_EXT_MAP[document.languageId] ?? null
  }
  return path.extname(document.fileName).toLowerCase()
}

function isSupportedExtension(ext: string): boolean {
  return JS_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext)
}

/**
 * Returns the active editor along with its resolved extension, or `null` when
 * there is no editor or the file type is not runnable (warning is shown).
 */
function getRunContext(): RunContext | null {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    return null
  }

  const document = editor.document
  const ext = resolveExtension(document)
  if (!ext || !isSupportedExtension(ext)) {
    vscode.window.showWarningMessage('Unsupported file type')
    return null
  }

  return { editor, document, ext }
}

/** Concatenates the full text of every line touched by a non-empty selection. */
function collectSelectedLines(editor: vscode.TextEditor): string {
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

function buildRunCommand(filePath: string, ext: string): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
  const nodeCmd = config.get<string>('nodeCommand', 'node')

  if (JS_EXTENSIONS.has(ext)) {
    return `${nodeCmd} "${filePath}"`
  }

  const fallbackCmd = config.get<string>('tsFallbackCommand', 'npx --yes tsx')
  if (isVersionGte(23, 6)) {
    return `${nodeCmd} "${filePath}"`
  }
  if (isVersionGte(22, 6)) {
    return `${nodeCmd} --experimental-strip-types "${filePath}"`
  }
  return `${fallbackCmd} "${filePath}"`
}

function runFile(filePath: string, ext: string, isTemp: boolean) {
  const definition: QuickRunTaskDefinition = { type: TASK_TYPE, filePath }
  const task = new vscode.Task(
    definition,
    vscode.TaskScope.Workspace,
    'Run JS/TS',
    TASK_TYPE,
    new vscode.ShellExecution(buildRunCommand(filePath, ext)),
  )
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    focus: true,
  }

  if (isTemp) {
    pendingCleanup.add(filePath)
  }

  vscode.tasks.executeTask(task)
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function handleRunFile() {
  const ctx = getRunContext()
  if (!ctx) {
    return
  }

  const { document, ext } = ctx
  if (document.isUntitled) {
    runFile(writeTempFile(ext, document.getText()), ext, true)
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
    vscode.window.showWarningMessage('No content selected to run')
    return
  }

  runFile(writeTempFile(ctx.ext, content), ctx.ext, true)
}

function handleTaskEnd(event: vscode.TaskEndEvent) {
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

export const activate = (context: vscode.ExtensionContext) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('quick-run-js-ts.runFile', handleRunFile),
    vscode.commands.registerCommand('quick-run-js-ts.runSelection', handleRunSelection),
    vscode.tasks.onDidEndTask(handleTaskEnd),
  )
}

export function deactivate() {}
