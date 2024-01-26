const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log } = require('../helpers/log')

async function main() {
  // 0x01 is too little, 0x80 works, although less might be enough
  await ethers.provider.send('hardhat_mine', ["0x80"])
  log.success(`Send "hardhat_mine"`)
}

module.exports = runOrWrapScript(main, module)
