import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionContext, TextDocument, TextEditor, Position, Selection } from 'vscode'

// ---------------------------------------------------------------------------
// vscode mock setup (must be before extension import)
// ---------------------------------------------------------------------------

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>()
let taskEndHandler: ((event: unknown) => void) | undefined

const mockConfigValues: Record<string, string> = {
  runtime: 'node',
  tsFallbackCommand: 'npx --yes tsx',
  debugMode: 'auto',
}

const mockConfig = {
  get: vi.fn<(key: string, fallback: string) => string>((key: string, fallback: string) => mockConfigValues[key] ?? fallback),
}

vi.mock('vscode', () => {
  class MockSourceBreakpoint {
    location: { uri: { fsPath: string } }
    constructor(location: { uri: { fsPath: string } }) {
      this.location = location
    }
  }

  return {
    window: {
      activeTextEditor: null as TextEditor | null,
      showWarningMessage: vi.fn<(msg: string) => void>(),
      createOutputChannel: vi.fn<() => { appendLine: (msg: string) => void; dispose: () => void }>(() => ({
        appendLine: vi.fn<(msg: string) => void>(),
        dispose: vi.fn<() => void>(),
      })),
    },
    workspace: {
      getConfiguration: vi.fn<() => typeof mockConfig>(() => mockConfig),
    },
    debug: {
      breakpoints: [] as unknown[],
      startDebugging: vi.fn<() => void>(),
    },
    tasks: {
      executeTask: vi.fn<() => void>(),
      onDidEndTask: vi.fn<(handler: (event: unknown) => void) => { dispose: () => void }>((handler: (event: unknown) => void) => {
        taskEndHandler = handler
        return { dispose: vi.fn<() => void>() }
      }),
    },
    commands: {
      registerCommand: vi.fn<(id: string, handler: (...args: unknown[]) => unknown) => { dispose: () => void }>((id: string, handler: (...args: unknown[]) => unknown) => {
        registeredCommands.set(id, handler)
        return { dispose: vi.fn<() => void>() }
      }),
    },
    Task: vi.fn<(def: unknown) => void>(function (this: Record<string, unknown>, def: unknown) {
      this.definition = def
    }),
    TaskScope: { Workspace: 2 },
    ShellExecution: vi.fn<() => void>(),
    TaskRevealKind: { Always: 2 },
    TaskPanelKind: { Shared: 2 },
    SourceBreakpoint: MockSourceBreakpoint,
  }
})

vi.mock('node:child_process', () => ({
  execSync: vi.fn<() => string>(() => 'v23.6.0\n'),
}))

// Import extension after mocks are set up
import { activate, deactivate, pendingCleanup } from '../extension'
import * as vscode from 'vscode'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocument(overrides: Partial<TextDocument> = {}): TextDocument {
  const lines = (overrides as Record<string, unknown>).testLines as string[] ?? []
  return {
    languageId: 'javascript',
    fileName: '/test/file.js',
    isUntitled: false,
    getText: () => lines.join('\n'),
    lineAt: (lineOrPosition: number | Position) => {
      const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line
      return { text: lines[line] ?? '' }
    },
    ...overrides,
  } as unknown as TextDocument
}

function makeEditor(document: TextEditor['document'], selections: Selection[] = []): TextEditor {
  return {
    document,
    selections,
  } as unknown as TextEditor
}

function makeSelection(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): Selection {
  return {
    isEmpty: startLine === endLine && startChar === endChar,
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  } as unknown as Selection
}

function makeTaskEndEvent(filePath: string, type = 'quick-run-js-ts') {
  return {
    execution: {
      task: {
        definition: { type, filePath },
      },
    },
  }
}

function activateExtension() {
  const context = { subscriptions: [] as { dispose(): void }[] } as unknown as ExtensionContext
  activate(context)
}

function setBreakpoints(bps: unknown[]) {
  ;(vscode.debug as unknown as { breakpoints: unknown[] }).breakpoints = bps
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Quick Run JS/TS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredCommands.clear()
    taskEndHandler = undefined
    mockConfigValues.runtime = 'node'
    mockConfigValues.tsFallbackCommand = 'npx --yes tsx'
    mockConfigValues.debugMode = 'auto'
    ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = null
    setBreakpoints([])
    pendingCleanup.clear()
    vi.mocked(execSync).mockReturnValue('v23.6.0\n')
  })

  // =========================================================================
  // Constants
  // =========================================================================

  describe('constants', () => {
    it('supports common JS extensions', async () => {
      const { JS_EXTENSIONS } = await import('../extension')
      expect(JS_EXTENSIONS).toContain('.js')
      expect(JS_EXTENSIONS).toContain('.mjs')
      expect(JS_EXTENSIONS).toContain('.cjs')
      expect(JS_EXTENSIONS).toContain('.node')
    })

    it('supports common TS extensions', async () => {
      const { TS_EXTENSIONS } = await import('../extension')
      expect(TS_EXTENSIONS).toContain('.ts')
      expect(TS_EXTENSIONS).toContain('.mts')
      expect(TS_EXTENSIONS).toContain('.cts')
    })

    it('maps language IDs to extensions', async () => {
      const { LANG_EXT_MAP } = await import('../extension')
      expect(LANG_EXT_MAP.javascript).toBe('.js')
      expect(LANG_EXT_MAP.typescript).toBe('.ts')
    })
  })

  // =========================================================================
  // isNode
  // =========================================================================

  describe('isNode', () => {
    it.each([
      ['node', true],
      ['/usr/local/bin/node', true],
      ['/usr/local/bin/node.exe', true],
      ['bun', false],
      ['deno', false],
      ['npx', false],
      ['my-custom-node', false],
      ['/path/to/my-custom-node', false],
    ])('isNode(%s) === %s', async (runtime, expected) => {
      const { isNode } = await import('../extension')
      expect(isNode(runtime)).toBe(expected)
    })
  })

  // =========================================================================
  // isSupportedExtension
  // =========================================================================

  describe('isSupportedExtension', () => {
    it.each([
      ['.js', true],
      ['.mjs', true],
      ['.cjs', true],
      ['.node', true],
      ['.ts', true],
      ['.mts', true],
      ['.cts', true],
      ['.json', false],
      ['.md', false],
      ['', false],
    ])('isSupportedExtension(%s) === %s', async (ext, expected) => {
      const { isSupportedExtension } = await import('../extension')
      expect(isSupportedExtension(ext)).toBe(expected)
    })
  })

  // =========================================================================
  // resolveExtension
  // =========================================================================

  describe('resolveExtension', () => {
    it('returns extension from language ID', async () => {
      const { resolveExtension } = await import('../extension')
      const doc = makeDocument({ languageId: 'typescript' } as Partial<TextDocument>)
      expect(resolveExtension(doc)).toBe('.ts')
    })

    it('falls back to file extension when language ID is unknown', async () => {
      const { resolveExtension } = await import('../extension')
      const doc = makeDocument({ languageId: 'unknown', fileName: '/test/file.mjs' } as Partial<TextDocument>)
      expect(resolveExtension(doc)).toBe('.mjs')
    })

    it('returns null when no extension can be resolved', async () => {
      const { resolveExtension } = await import('../extension')
      const doc = makeDocument({ languageId: 'unknown', fileName: '/test/file' } as Partial<TextDocument>)
      expect(resolveExtension(doc)).toBeNull()
    })
  })

  // =========================================================================
  // Node version detection
  // =========================================================================

  describe('Node version detection', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it('resolves version from `node -v` output', async () => {
      vi.mocked(execSync).mockReturnValue('v22.6.1\n')
      const { isNodeVersionGte } = await import('../extension')
      expect(isNodeVersionGte(22, 6)).toBe(true)
    })

    it('returns [0,0,0] on exec failure', async () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('not found') })
      const { isNodeVersionGte } = await import('../extension')
      expect(isNodeVersionGte(1, 0)).toBe(false)
    })

    it('handles major version comparison', async () => {
      vi.mocked(execSync).mockReturnValue('v24.0.0\n')
      const { isNodeVersionGte } = await import('../extension')
      expect(isNodeVersionGte(23, 6)).toBe(true)
    })

    it('handles exact version match', async () => {
      vi.mocked(execSync).mockReturnValue('v22.6.0\n')
      const { isNodeVersionGte } = await import('../extension')
      expect(isNodeVersionGte(22, 6)).toBe(true)
    })

    it('rejects lower minor version', async () => {
      vi.mocked(execSync).mockReturnValue('v22.5.0\n')
      const { isNodeVersionGte } = await import('../extension')
      expect(isNodeVersionGte(22, 6)).toBe(false)
    })
  })

  // =========================================================================
  // Temp file management
  // =========================================================================

  describe('temp files', () => {
    it('writeTempFile creates file and returns path with correct extension', async () => {
      const { writeTempFile } = await import('../extension')
      const filePath = writeTempFile('.ts', 'const x = 1')
      try {
        expect(filePath).toMatch(/snippet-.*\.ts$/)
        expect(fs.existsSync(filePath)).toBe(true)
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('const x = 1')
      } finally {
        fs.unlinkSync(filePath)
      }
    })

    it('cleanupTempFile removes the file from disk', async () => {
      const { writeTempFile, cleanupTempFile } = await import('../extension')
      const filePath = writeTempFile('.js', 'test')
      expect(fs.existsSync(filePath)).toBe(true)
      cleanupTempFile(filePath)
      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('generates unique file names', async () => {
      const { writeTempFile } = await import('../extension')
      const a = writeTempFile('.js', 'a')
      const b = writeTempFile('.js', 'b')
      try {
        expect(a).not.toBe(b)
      } finally {
        fs.unlinkSync(a)
        fs.unlinkSync(b)
      }
    })
  })

  // =========================================================================
  // collectSelectedLines
  // =========================================================================

  describe('collectSelectedLines', () => {
    it('collects single selection', async () => {
      const { collectSelectedLines } = await import('../extension')
      const doc = makeDocument({ testLines: ['line0', 'line1', 'line2'] } as unknown as Partial<TextDocument>)
      const sel = makeSelection(0, 0, 1, 5)
      const editor = makeEditor(doc, [sel])
      expect(collectSelectedLines(editor)).toBe('line0\nline1')
    })

    it('excludes end line when selection ends at char 0', async () => {
      const { collectSelectedLines } = await import('../extension')
      const doc = makeDocument({ testLines: ['line0', 'line1', 'line2'] } as unknown as Partial<TextDocument>)
      const sel = makeSelection(0, 0, 2, 0)
      const editor = makeEditor(doc, [sel])
      expect(collectSelectedLines(editor)).toBe('line0\nline1')
    })

    it('skips empty selections (bare cursor)', async () => {
      const { collectSelectedLines } = await import('../extension')
      const doc = makeDocument({ testLines: ['line0', 'line1'] } as unknown as Partial<TextDocument>)
      const empty = makeSelection(0, 0, 0, 0)
      const editor = makeEditor(doc, [empty])
      expect(collectSelectedLines(editor)).toBe('')
    })

    it('merges overlapping selections by line number', async () => {
      const { collectSelectedLines } = await import('../extension')
      const doc = makeDocument({ testLines: ['a', 'b', 'c'] } as unknown as Partial<TextDocument>)
      const sel1 = makeSelection(0, 0, 1, 0)
      const sel2 = makeSelection(1, 0, 2, 1)
      const editor = makeEditor(doc, [sel1, sel2])
      expect(collectSelectedLines(editor)).toBe('a\nb\nc')
    })

    it('returns empty string when no selections', async () => {
      const { collectSelectedLines } = await import('../extension')
      const doc = makeDocument({ testLines: ['a', 'b'] } as unknown as Partial<TextDocument>)
      const editor = makeEditor(doc, [])
      expect(collectSelectedLines(editor)).toBe('')
    })

    it('merges non-continuous selections', async () => {
      const { collectSelectedLines } = await import('../extension')
      const doc = makeDocument({ testLines: ['line0', 'line1', 'line2', 'line3'] } as unknown as Partial<TextDocument>)
      const sel1 = makeSelection(0, 0, 0, 5)
      const sel2 = makeSelection(2, 0, 3, 5)
      const editor = makeEditor(doc, [sel1, sel2])
      expect(collectSelectedLines(editor)).toBe('line0\nline2\nline3')
    })
  })

  // =========================================================================
  // getRunContext
  // =========================================================================

  describe('getRunContext', () => {
    it('returns null when no active editor', async () => {
      const { getRunContext } = await import('../extension')
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = null
      expect(getRunContext()).toBeNull()
    })

    it('shows warning for unsupported file type', async () => {
      const { getRunContext } = await import('../extension')
      const doc = makeDocument({ languageId: 'json', fileName: '/test/file.json' } as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)
      expect(getRunContext()).toBeNull()
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Unsupported file type')
    })

    it('returns context for supported JS file', async () => {
      const { getRunContext } = await import('../extension')
      const doc = makeDocument({ languageId: 'javascript', fileName: '/test/file.js' } as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)
      const ctx = getRunContext()
      expect(ctx).not.toBeNull()
      expect(ctx!.ext).toBe('.js')
      expect(ctx!.document).toBe(doc)
    })
  })

  // =========================================================================
  // wantsDebug
  // =========================================================================

  describe('wantsDebug', () => {
    it('returns false when mode is "never"', async () => {
      const { wantsDebug } = await import('../extension')
      mockConfigValues.debugMode = 'never'
      const doc = makeDocument({ fileName: '/test/file.js', isUntitled: false } as Partial<TextDocument>)
      expect(wantsDebug(doc)).toBe(false)
    })

    it('returns true when mode is "always"', async () => {
      const { wantsDebug } = await import('../extension')
      mockConfigValues.debugMode = 'always'
      const doc = makeDocument({ fileName: '/test/file.js', isUntitled: false } as Partial<TextDocument>)
      expect(wantsDebug(doc)).toBe(true)
    })

    it('returns true when mode is "auto" and breakpoints exist', async () => {
      const { wantsDebug } = await import('../extension')
      mockConfigValues.debugMode = 'auto'
      const doc = makeDocument({ fileName: '/test/file.js', isUntitled: false } as Partial<TextDocument>)
      setBreakpoints([
        new (vscode as unknown as { SourceBreakpoint: new (loc: unknown) => unknown }).SourceBreakpoint(
          { uri: { fsPath: '/test/file.js' } },
        ),
      ])
      expect(wantsDebug(doc)).toBe(true)
    })

    it('returns false when mode is "auto" and no breakpoints', async () => {
      const { wantsDebug } = await import('../extension')
      mockConfigValues.debugMode = 'auto'
      const doc = makeDocument({ fileName: '/test/file.js', isUntitled: false } as Partial<TextDocument>)
      setBreakpoints([])
      expect(wantsDebug(doc)).toBe(false)
    })

    it('returns false for untitled files in "auto" mode even with breakpoints', async () => {
      const { wantsDebug } = await import('../extension')
      mockConfigValues.debugMode = 'auto'
      const doc = makeDocument({ fileName: '/test/file.js', isUntitled: true } as Partial<TextDocument>)
      setBreakpoints([
        new (vscode as unknown as { SourceBreakpoint: new (loc: unknown) => unknown }).SourceBreakpoint(
          { uri: { fsPath: '/test/file.js' } },
        ),
      ])
      expect(wantsDebug(doc)).toBe(false)
    })
  })

  // =========================================================================
  // Command handlers (tested via registered commands)
  // =========================================================================

  describe('runFile command', () => {
    beforeEach(() => {
      activateExtension()
    })

    it('runs saved JS file as task', () => {
      const doc = makeDocument({ languageId: 'javascript', fileName: '/test/file.js' } as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      registeredCommands.get('quick-run-js-ts.runFile')!()

      expect(vscode.tasks.executeTask).toHaveBeenCalled()
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled()
    })

    it('runs untitled file via temp file', () => {
      const doc = makeDocument({
        languageId: 'javascript',
        isUntitled: true,
        getText: () => 'console.log("hello")',
      } as unknown as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      registeredCommands.get('quick-run-js-ts.runFile')!()

      expect(vscode.tasks.executeTask).toHaveBeenCalled()
    })

    it('shows warning for untitled file in "always" debug mode but still runs', () => {
      mockConfigValues.debugMode = 'always'
      const doc = makeDocument({
        languageId: 'javascript',
        isUntitled: true,
        getText: () => 'code',
      } as unknown as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      registeredCommands.get('quick-run-js-ts.runFile')!()

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Debug mode is not available for untitled files. Please save the file first.',
      )
      expect(vscode.tasks.executeTask).toHaveBeenCalled()
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled()
    })

    it('launches debugger when breakpoints are set', () => {
      mockConfigValues.debugMode = 'auto'
      const doc = makeDocument({ languageId: 'javascript', fileName: '/test/file.js' } as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)
      setBreakpoints([
        new (vscode as unknown as { SourceBreakpoint: new (loc: unknown) => unknown }).SourceBreakpoint(
          { uri: { fsPath: '/test/file.js' } },
        ),
      ])

      registeredCommands.get('quick-run-js-ts.runFile')!()

      expect(vscode.debug.startDebugging).toHaveBeenCalled()
      expect(vscode.tasks.executeTask).not.toHaveBeenCalled()
    })

    it('does nothing when no active editor', () => {
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = null
      registeredCommands.get('quick-run-js-ts.runFile')!()
      expect(vscode.tasks.executeTask).not.toHaveBeenCalled()
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled()
    })

    it('runs TS file with experimental-strip-types on node >= 22.6', () => {
      // Reset commands and re-activate with new node version
      registeredCommands.clear()
      vi.mocked(execSync).mockReturnValue('v22.6.0\n')
      activateExtension()

      const doc = makeDocument({ languageId: 'typescript', fileName: '/test/file.ts' } as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      registeredCommands.get('quick-run-js-ts.runFile')!()

      expect(vscode.tasks.executeTask).toHaveBeenCalled()
      expect(vscode.ShellExecution).toHaveBeenCalledWith(
        expect.stringContaining('--experimental-strip-types'),
      )
    })

    it('runs TS file with tsx fallback on older node', () => {
      vi.mocked(execSync).mockReturnValue('v20.0.0\n')
      mockConfigValues.tsFallbackCommand = 'npx --yes tsx'
      vi.resetModules()

      const doc = makeDocument({ languageId: 'typescript', fileName: '/test/file.ts' } as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      registeredCommands.get('quick-run-js-ts.runFile')!()

      expect(vscode.tasks.executeTask).toHaveBeenCalled()
    })
  })

  describe('runSelection command', () => {
    beforeEach(() => {
      activateExtension()
    })

    it('runs selected lines via temp file', () => {
      const doc = makeDocument({
        languageId: 'javascript',
        fileName: '/test/file.js',
        testLines: ['const a = 1', 'const b = 2', 'const c = 3'],
      } as unknown as Partial<TextDocument>)
      const sel = makeSelection(0, 0, 1, 11)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc, [sel])

      registeredCommands.get('quick-run-js-ts.runSelection')!()

      expect(vscode.tasks.executeTask).toHaveBeenCalled()
    })

    it('shows warning when no content is selected', () => {
      const doc = makeDocument({ languageId: 'javascript', fileName: '/test/file.js' } as Partial<TextDocument>)
      const emptySel = makeSelection(0, 0, 0, 0)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc, [emptySel])

      registeredCommands.get('quick-run-js-ts.runSelection')!()

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No content selected to run')
      expect(vscode.tasks.executeTask).not.toHaveBeenCalled()
    })

    it('shows warning when debug would trigger on selection but still runs', () => {
      mockConfigValues.debugMode = 'always'
      const doc = makeDocument({
        languageId: 'javascript',
        fileName: '/test/file.js',
        testLines: ['const a = 1', 'const b = 2'],
      } as unknown as Partial<TextDocument>)
      const sel = makeSelection(0, 0, 1, 11)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc, [sel])

      registeredCommands.get('quick-run-js-ts.runSelection')!()

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Debug mode is not available for running selections.',
      )
      expect(vscode.tasks.executeTask).toHaveBeenCalled()
    })

    it('does nothing when no active editor', () => {
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = null
      registeredCommands.get('quick-run-js-ts.runSelection')!()
      expect(vscode.tasks.executeTask).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Task end cleanup
  // =========================================================================

  describe('task end cleanup', () => {
    beforeEach(() => {
      activateExtension()
    })

    it('cleans up temp file when task ends', () => {
      const doc = makeDocument({
        languageId: 'javascript',
        isUntitled: true,
        getText: () => 'temp code',
      } as unknown as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      // Run to create temp file
      registeredCommands.get('quick-run-js-ts.runFile')!()

      const executeTaskMock = vi.mocked(vscode.tasks.executeTask)
      const task = executeTaskMock.mock.calls[0][0] as unknown as { definition: { filePath: string } }
      const tempPath = task.definition.filePath

      expect(fs.existsSync(tempPath)).toBe(true)

      // Simulate task end
      taskEndHandler!(makeTaskEndEvent(tempPath))

      expect(fs.existsSync(tempPath)).toBe(false)
    })

    it('ignores task end events for non-matching task types', () => {
      const doc = makeDocument({
        languageId: 'javascript',
        isUntitled: true,
        getText: () => 'temp code',
      } as unknown as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      registeredCommands.get('quick-run-js-ts.runFile')!()

      const executeTaskMock = vi.mocked(vscode.tasks.executeTask)
      const task = executeTaskMock.mock.calls[0][0] as unknown as { definition: { filePath: string } }
      const tempPath = task.definition.filePath

      taskEndHandler!(makeTaskEndEvent(tempPath, 'other-type'))

      expect(fs.existsSync(tempPath)).toBe(true)

      // Clean up
      fs.unlinkSync(tempPath)
    })

    it('handles task end event with undefined filePath gracefully', () => {
      expect(() => {
        taskEndHandler!(makeTaskEndEvent(undefined as unknown as string))
      }).not.toThrow()
    })
  })

  // =========================================================================
  // resolveTsCommand
  // =========================================================================

  describe('resolveTsCommand', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it('returns runtime directly for JS extensions', async () => {
      const { resolveTsCommand } = await import('../extension')
      expect(resolveTsCommand('.js', 'node')).toBe('node')
      expect(resolveTsCommand('.mjs', 'bun')).toBe('bun')
    })

    it('returns runtime directly for non-node runtimes', async () => {
      const { resolveTsCommand } = await import('../extension')
      expect(resolveTsCommand('.ts', 'bun')).toBe('bun')
      expect(resolveTsCommand('.ts', 'deno')).toBe('deno')
    })

    it('returns runtime for TS on node >= 23.6 (native support)', async () => {
      vi.mocked(execSync).mockReturnValue('v23.6.0\n')
      const { resolveTsCommand } = await import('../extension')
      expect(resolveTsCommand('.ts', 'node')).toBe('node')
    })

    it('adds --experimental-strip-types for node >= 22.6', async () => {
      vi.mocked(execSync).mockReturnValue('v22.6.0\n')
      const { resolveTsCommand } = await import('../extension')
      expect(resolveTsCommand('.ts', 'node')).toBe('node --experimental-strip-types')
    })

    it('falls back to tsFallbackCommand for older node', async () => {
      vi.mocked(execSync).mockReturnValue('v20.0.0\n')
      mockConfigValues.tsFallbackCommand = 'npx --yes tsx'
      const { resolveTsCommand } = await import('../extension')
      expect(resolveTsCommand('.ts', 'node')).toBe('npx --yes tsx')
    })
  })

  // =========================================================================
  // Activation / Deactivation
  // =========================================================================

  describe('activate / deactivate', () => {
    it('registers runFile, runSelection, and taskEndHandler', () => {
      activateExtension()

      expect(registeredCommands.has('quick-run-js-ts.runFile')).toBe(true)
      expect(registeredCommands.has('quick-run-js-ts.runSelection')).toBe(true)
      expect(taskEndHandler).toBeDefined()
    })

    it('deactivate cleans up all pending temp files', () => {
      activateExtension()

      const doc = makeDocument({
        languageId: 'javascript',
        isUntitled: true,
        getText: () => 'temp',
      } as unknown as Partial<TextDocument>)
      ;(vscode.window as { activeTextEditor: TextEditor | null }).activeTextEditor = makeEditor(doc)

      registeredCommands.get('quick-run-js-ts.runFile')!()

      const executeTaskMock = vi.mocked(vscode.tasks.executeTask)
      const task = executeTaskMock.mock.calls[0][0] as unknown as { definition: { filePath: string } }
      const tempPath = task.definition.filePath

      expect(fs.existsSync(tempPath)).toBe(true)

      deactivate()

      expect(fs.existsSync(tempPath)).toBe(false)
    })
  })
})
