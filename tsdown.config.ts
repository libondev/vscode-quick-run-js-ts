import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  outExtensions: () => ({ js: '.js' }),
  deps: {
    neverBundle: ['vscode'],
  },
  clean: true,
  dts: true,
})
