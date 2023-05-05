const minimatch = require('minimatch')
const { subtask } = require('hardhat/config')
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require('hardhat/builtin-tasks/task-names')

/**
 * Excludes Solidity test files from the Hardhat compilation. This step is required to avoid
 * compilation errors when Hardhat can't find Foundry-specific solidity files.
 *
 * This function is used instead of the "hardhat-foundry" plugin because the last one is not
 * compatible with the "solidity-coverage" plugin. After enabling "hardhat-foundry" coverage
 * reports are always empty.
 */
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, __, runSuper) => {
  const paths = await runSuper()
  return paths.filter((path) => !minimatch(path, '**/test/**/*.sol'))
})
