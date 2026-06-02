const os = require('node:os')

function getSystemInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    freeMemory: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
  }
}

module.exports = { getSystemInfo }

console.table(getSystemInfo())
