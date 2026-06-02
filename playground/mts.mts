import { resolve } from 'node:path'
import process from 'node:process'

type PathSegments = [...string[]]

export function buildPath(...segments: PathSegments): string {
  return resolve(...segments)
}

const fullPath = buildPath(process.cwd(), 'src', 'index.ts')
console.log('Resolved path:', fullPath)
