const { log } = require('./log')
const runOrWrapScript = require('./run-or-wrap-script')

const IPFS_HASH = process.env.IPFS_HASH
if (!IPFS_HASH) {
  throw new Error('Missing `IPFS_HASH` environment variable!')
}

const getContentUri = async () => {
  const protocol = 'ipfs'
  const utf8 = [protocol, IPFS_HASH].join(':')
  const contentURI = '0x' + Buffer.from(utf8, 'utf8').toString('hex')
  log.success(contentURI)
}

module.exports = runOrWrapScript(getContentUri, module)
