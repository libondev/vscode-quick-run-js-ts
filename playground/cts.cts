// @ts-ignore
const process = require('node:process')

interface RuntimeInfo {
  nodeVersion: string
  uptime: number
}

function getRuntimeInfo(): RuntimeInfo {
  return {
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
  }
}

// @ts-ignore
module.exports = {
  getRuntimeInfo,
}

console.table(getRuntimeInfo())
