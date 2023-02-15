const fs = require('fs')
const path = require('path')
const minimatch = require('minimatch')
const { subtask } = require('hardhat/config')
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require('hardhat/builtin-tasks/task-names')

/**
 * Excludes Foundry test files from the Hardhat compilation. This step is required to avoid
 * compilation errors when Hardhat can't find Foundry-specific solidity files.
 *
 * This function is used instead of the "hardhat-foundry" plugin because the last one is not
 * compatible with the "solidity-coverage" plugin. After enabling "hardhat-foundry" coverage
 * reports are always empty.
 */
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, __, runSuper) => {
  const foundryTomlPath = path.join(__dirname, '..', 'foundry.toml')
  const matchPath = parseTomlValue(readTomlValue(await readTextFile(foundryTomlPath), 'match_path'))
  const paths = await runSuper()
  if (!matchPath) {
    console.warn(
      [
        'WARNING:',
        "'foundry.toml' file doesn't contain the 'match_path' property, or its value is empty.",
        "If you don't use Foundry tests, the 'skip-sol-tests-compilation' subtask might be removed from hardhat.config.js"
      ].join(' ')
    )
    return paths
  }
  return paths.filter((path) => !minimatch(path, matchPath))
})

function readTextFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) reject(err)
      resolve(data)
    })
  })
}

function readTomlValue(tomlFile, key) {
  const line = tomlFile.split('\n').find((line) => line.startsWith(key))
  if (line === undefined) return null
  return line.split('=')[1].trim()
}

function parseTomlValue(value) {
  // TOML allows to use both "" and '' quotes for strings
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, value.length - 1)
  } else {
    throw new Error(`Unsupported or invalid TOML parser value: ${value}`)
  }
}
