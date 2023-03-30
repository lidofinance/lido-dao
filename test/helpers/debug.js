const { BN } = require('bn.js')

// transforms all object entries
const transformEntries = (obj, tr) =>
  Object.fromEntries(
    Object.entries(obj)
      .map(tr)
      .filter((x) => x !== undefined)
  )

// converts all object BN keys to strings, drops numeric keys and the __length__ key
const processNamedTuple = (obj) =>
  transformEntries(obj, ([k, v]) => {
    return /^(\d+|__length__)$/.test(k) ? undefined : [k, BN.isBN(v) ? v.toString() : v]
  })

const printEvents = (tx) => {
  console.log(tx.receipt.logs.map(({ event, args }) => ({ event, args: processNamedTuple(args) })))
}

module.exports = { transformEntries, processNamedTuple, printEvents }
