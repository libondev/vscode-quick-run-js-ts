import { randomUUID } from 'node:crypto'

export function generateId() {
  return randomUUID()
}

const id = generateId()
console.log('Generated ID:', id)
