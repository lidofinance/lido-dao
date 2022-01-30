const { create, globSource } = require('ipfs-http-client')

const globSourceOptions = {
  recursive: true
}

const addOptions = {
  pin: true,
  wrapWithDirectory: true,
  timeout: 10000
}

async function uploadDirToIpfs({ apiUrl, dirPath }) {
  const ipfs = await create(apiUrl)

  const results = []
  for await (const result of ipfs.addAll(globSource(dirPath, '*', globSourceOptions), addOptions)) {
    results.push(result)
  }
  return results.find((r) => r.path === '').cid.toString()
}

module.exports = { uploadDirToIpfs }
