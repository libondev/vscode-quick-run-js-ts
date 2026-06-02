import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

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

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])

const LANG_EXT_MAP: Record<string, string> = {
  javascript: '.js',
  typescript: '.ts',
}

const pendingCleanup = new Set<string>()

function cleanupTempFile(filePath: string) {
  try {
    fs.unlinkSync(filePath)
  } finally {
    pendingCleanup.delete(filePath)
  }
}

function buildTsCommand(filePath: string, nodeCmd: string, fallbackCmd: string): string {
  if (isVersionGte(23, 6)) {
    return `${nodeCmd} "${filePath}"`
  }

  if (isVersionGte(22, 6)) {
    return `${nodeCmd} --experimental-strip-types "${filePath}"`
  }

  return `${fallbackCmd} "${filePath}"`
}

export const activate = (context: vscode.ExtensionContext) => {
  const runFileCommand = vscode.commands.registerCommand('quick-run-js-ts.runFile', () => {
    const editor = vscode.window.activeTextEditor

    if (!editor) {
      return
    }

    const document = editor.document
    let filePath = document.fileName
    let fileExtension = path.extname(filePath).toLowerCase()
    let isTemp = false

    if (document.isUntitled) {
      const ext = LANG_EXT_MAP[document.languageId]
      if (!ext) {
        vscode.window.showWarningMessage('Unsupported file type')
        return
      }
      const tmpDir = path.join(os.tmpdir(), 'quick-run-js-ts')
      fs.mkdirSync(tmpDir, { recursive: true })
      filePath = path.join(tmpDir, `untitled-${Date.now()}${ext}`)
      fs.writeFileSync(filePath, document.getText(), 'utf-8')
      fileExtension = ext
      isTemp = true
    }

    let command: string
    const config = vscode.workspace.getConfiguration('quickRunJsTs')
    const nodeCmd = config.get<string>('nodeCommand', 'node')

    if (JS_EXTENSIONS.has(fileExtension)) {
      command = `${nodeCmd} "${filePath}"`
    } else if (TS_EXTENSIONS.has(fileExtension)) {
      command = buildTsCommand(
        filePath,
        nodeCmd,
        config.get<string>('tsFallbackCommand', 'npx --yes tsx'),
      )
    } else {
      vscode.window.showWarningMessage('Unsupported file type')
      if (isTemp) {
        cleanupTempFile(filePath)
      }
      return
    }

    const task = new vscode.Task(
      { type: 'quick-run-js-ts', filePath },
      vscode.TaskScope.Workspace,
      'Run JS/TS',
      'quick-run-js-ts',
      new vscode.ShellExecution(command),
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
  })

  context.subscriptions.push(
    runFileCommand,
    vscode.tasks.onDidEndTask((e) => {
      if (e.execution.task.definition.type !== 'quick-run-js-ts') {
        return
      }

      const taskPath = (e.execution.task.definition as { filePath?: string }).filePath
      if (taskPath && pendingCleanup.has(taskPath)) {
        cleanupTempFile(taskPath)
      }
    }),
  )
}

export function deactivate() {}
