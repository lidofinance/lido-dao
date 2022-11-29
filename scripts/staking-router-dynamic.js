// todo: проверить линейная разблокировка?
// todo: чем больше ключей у модуля, тем быстрее разблокировать их для других модулей

const curatedModule = {
  name: 'Curated',
  addr: '0x010101010101010101',
  cap: 0,

  total_keys: 1023, // total amount of signing keys of this operator
  used_keys: 122, // number of signing keys of this operator which were used in deposits to the Ethereum 2
  stopped_keys: 0, // number of signing keys which stopped validation (e.g. were slashed)
  exited_keys: 0,
  assigned_keys: 0,
  lastDepositAt: 0,
  recycleRestAmount: 0,
  recycleLevel: 0,
  recycleAt: 0
}

const communityModule = {
  name: 'Community',
  addr: '0x010101010101010101',
  cap: 100,

  total_keys: 39,
  used_keys: 12,
  stopped_keys: 0,
  exited_keys: 0,
  assigned_keys: 0,
  lastDepositAt: 0,
  recycleRestAmount: 0,
  recycleLevel: 0,
  recycleAt: 0
}
const communityModule2 = {
  name: 'Community2',
  addr: '0x010101010101010101',
  cap: 500,

  total_keys: 297,
  used_keys: 0,
  stopped_keys: 0,
  exited_keys: 0,
  assigned_keys: 0,
  lastDepositAt: 0,
  recycleRestAmount: 0,
  recycleLevel: 0,
  recycleAt: 0
}
/// ////

const Time = {
  base: 0,
  cur: 0,
  prev: 0,
  init() {
    this.base = Math.floor(new Date().getTime() / 1000)
    this.cur = this.base
    // this.prev = this.base
  },
  shift(h) {
    // this.prev = this.cur
    this.cur = this.base + h * 3600
  },
  diff() {
    return ((this.cur - this.base) / 3600).toFixed(2)
  },
  now() {
    return this.cur
  }
}

const recycleLevels = [
  { delay: 12 * 3600, percent: 0 }, // 0% during 12h
  { delay: 15 * 3600, percent: 5000 }, // 50% after 12h
  { delay: 18 * 3600, percent: 7500 }, // 75% after 15h
  { delay: 0, percent: 10000 } // 100% after 18h
]

const Lido = {
  bufferAmount: 0,
  reservedAmount: 1000,
  lastReportTime: 0,

  oracleReport(amount = 0) {
    this.bufferAmount += amount
    this.lastReportTime = Time.now()
  },

  flushBuffer() {
    if (this.bufferAmount <= this.reservedAmount) {
      throw new Error('no free ether in buffer')
    }

    const amount = this.bufferAmount - this.reservedAmount
    StakingRouter.balance += amount
    this.bufferAmount -= amount
  }
}

const StakingRouter = {
  modules: [],
  modulesCount: 0,

  bufferKeys: 0,
  balance: 0,
  allocation: [],

  getTotalKeys: function () {
    // calculate total used keys for operators
    const moduleKeys = []
    let totalKeys = 0
    for (let i = 0; i < this.modulesCount; i++) {
      moduleKeys[i] = this.modules[i].total_keys
      totalKeys += moduleKeys[i]
    }

    return [totalKeys, moduleKeys]
  },

  addModule: function (module) {
    // this.modules.push({ name, addr, cap, paused: false })
    this.modules.push(module)
    this.modulesCount++
  },

  getModules: function () {
    return this.modules
  },

  getLastReportTime() {
    return Lido.lastReportTime
  },

  flushAndAllocate() {
    Lido.flushBuffer()
    this.allocate()
  },

  allocate: function () {
    const balKeys = Math.floor(this.balance / 32)

    if (balKeys < this.bufferKeys) {
      throw new Error('wrong balance/bufferKeys')
    } else if (balKeys > this.bufferKeys) {
      this.bufferKeys += balKeys - this.bufferKeys
      return this.stakeAllocation()
    } else {
      console.log('!!! no new allocation')
    }
  },

  stakeAllocation: function () {
    const cache = JSON.parse(JSON.stringify(this.modules))

    const totalKeys = this.getTotalKeys()[0]

    const _numDeposits = this.bufferKeys

    let assignedDeposits = 0
    let entry
    while (assignedDeposits < _numDeposits) {
      let bestModuleIdx = this.modulesCount
      let smallestStake = 0

      for (let i = 0; i < this.modulesCount; i++) {
        entry = cache[i]

        if (entry.used_keys === entry.total_keys || entry.used_keys + entry.assigned_keys === entry.total_keys) {
          continue
        }

        // calculate least stake
        const stake = entry.used_keys - entry.stopped_keys - entry.exited_keys
        const soft_cap = entry.cap

        const keys_cap = entry.used_keys + entry.assigned_keys

        if (soft_cap > 0 && keys_cap / totalKeys >= soft_cap) {
          console.log('cap')
          continue
        }

        // console.table({
        //   i, soft_cap, keys_cap , totalKeys
        // })

        if (bestModuleIdx === this.modulesCount || stake + entry.assigned_keys < smallestStake) {
          bestModuleIdx = i
          smallestStake = stake + entry.assigned_keys
        }
      }

      if (bestModuleIdx === this.modulesCount)
        // not found
        break

      entry = cache[bestModuleIdx]

      ++entry.assigned_keys
      ++assignedDeposits
    }

    for (let i = 0; i < this.modulesCount; i++) {
      this.allocation[i] = cache[i].assigned_keys
    }

    return this.allocation
  },
  getModuleMaxKeys(index) {
    const recycleCache = this.getRecycledKeys()
    let recycledKeysAmount = recycleCache.total - recycleCache.keysAmounts[index]
    const allocKeysAmount = this.allocation[index]

    if (this.modules[index].used_keys + allocKeysAmount + recycledKeysAmount > this.modules[index].total_keys) {
      recycledKeysAmount = this.modules[index].total_keys - this.modules[index].used_keys - allocKeysAmount
    }
    return [allocKeysAmount, recycledKeysAmount]
  },
  getRecycledKeys: function () {
    const recycleCache = { total: 0, levels: Array(this.modulesCount).fill(0), keysAmounts: Array(this.modulesCount).fill(0) }
    const now = Time.now()
    const lastReportAt = this.getLastReportTime()

    let timeDelta

    for (let i = 0; i < this.modulesCount; i++) {
      const curAllocation = this.allocation[i]

      if (curAllocation === 0) {
        // console.log(`module #${i}: no allocation, skip`)
        continue
      }

      const recycleAt = this.modules[i].recycleAt
      if (recycleAt > lastReportAt) {
        // default assumes we are still on the same level
        recycleCache.levels[i] = this.modules[i].recycleLevel
        recycleCache.keysAmounts[i] = this.modules[i].recycleRestAmount
      } else {
        recycleCache.levels[i] = 0
        recycleCache.keysAmounts[i] = 0
      }

      const lastDeposit = this.modules[i].lastDepositAt
      if (lastDeposit > lastReportAt) {
        // if module deposit has ocurred after report, check module slowness based on it lastDeposit time
        timeDelta = now - lastDeposit
      } else {
        // check module slowness based on lastReportAt time
        timeDelta = now - lastReportAt
      }

      // let kMod = Math.floor((curAllocation * 10000) / this.bufferKeys)
      // console.log({ kMod, curAllocation, bufferKeys: this.bufferKeys })

      let curLevel
      let delay
      // find cur recycle level
      for (curLevel = recycleCache.levels[i]; curLevel < recycleLevels.length; curLevel++) {
        delay = recycleLevels[curLevel].delay

        // reduce delay for modules with bigger stake
        // delay = Math.floor((recycleLevels[curLevel].delay * (10000 - kMod)) / 10000)
        if (timeDelta <= delay || delay === 0) {
          break
        }
      }
      if (curLevel === 0) {
        // skip healthy module
        console.log(`skip module #${i}: level ${recycleCache.levels[i]}, recycle keys rest ${recycleCache.keysAmounts[i]}`)
        continue
      }
      // sanity fix last level, just in case incorrect recycleLevels definition
      else if (curLevel === recycleLevels.length) {
        curLevel--
      }
      // skip if the current level is the same
      if (curLevel > recycleCache.levels[i]) {
        // adjust amount according module share in provision stake
        // todo: едж кейс: модуль всего 1 или только один модуль не депозитит
        // let percent = recycleLevels[curLevel].percent + ((10000 - recycleLevels[curLevel].percent) * kMod) / 10000
        const percent = recycleLevels[curLevel].percent
        // console.log({ percent })
        recycleCache.keysAmounts[i] = Math.floor((curAllocation * percent) / 10000)
        recycleCache.levels[i] = curLevel
      }
      // console.log(`module #${i}: level ${recycleCache.levels[i]}, recycle keys rest ${recycleCache.keysAmounts[i]}`)

      recycleCache.total += recycleCache.keysAmounts[i]
    }
    return recycleCache
  },

  useRecycledKeys: function (index, recycledKeysAmount, recycleCache) {
    if (recycledKeysAmount > recycleCache.total) {
      throw new Error('exceed recycled amount')
    }

    for (let i = 0; i < this.modulesCount; i++) {
      if (recycleCache.keysAmounts[i] === 0 || index === i) {
        // console.log('skip recycled', { m: i })
        continue
      }
      let keysToUse
      if (recycleCache.keysAmounts[i] > recycledKeysAmount) {
        keysToUse = recycledKeysAmount
      } else {
        keysToUse = recycleCache.keysAmounts[i]
      }

      if (this.allocation[i] > keysToUse) {
        this.modules[i].recycleRestAmount = recycleCache.keysAmounts[i] - keysToUse
        this.modules[i].recycleLevel = recycleCache.levels[i]
        this.allocation[i] -= keysToUse
      } else if (this.allocation[i] === keysToUse) {
        this.modules[i].recycleRestAmount = 0
        this.modules[i].recycleLevel = 0
        this.allocation[i] = 0
      } else {
        throw new Error('allocation < keysToUse')
      }
      this.modules[i].recycleAt = Time.now()

      // console.log('use recycled', { m: i, keysToUse, rest: this.modules[i].recycleRestAmount, level: this.modules[i].recycleLevel })

      recycledKeysAmount -= keysToUse

      if (recycledKeysAmount === 0) {
        break
      }
    }
    if (recycledKeysAmount > 0) {
      throw new Error('wrong recycle cache')
    }
  },

  deposit: function (index, keysAmount) {
    const recycleCache = this.getRecycledKeys()
    let recycledKeysAmount = recycleCache.total - recycleCache.keysAmounts[index]
    let allocKeysAmount = this.allocation[index]

    // todo: check module max keys and cap
    if (keysAmount > allocKeysAmount + recycledKeysAmount || this.modules[index].used_keys + keysAmount > this.modules[index].total_keys) {
      throw new Error('not enough keys')
    }
    // recycled amount correction
    if (keysAmount > allocKeysAmount) {
      recycledKeysAmount = keysAmount - allocKeysAmount
    } else {
      recycledKeysAmount = 0
      allocKeysAmount = keysAmount
    }

    this.allocation[index] -= allocKeysAmount

    if (this.allocation[index] === 0) {
      this.modules[index].recycleRestAmount = 0
      this.modules[index].recycleLevel = 0
    }

    if (recycledKeysAmount > 0) {
      this.useRecycledKeys(index, recycledKeysAmount, recycleCache)
    }

    this.modules[index].used_keys += keysAmount
    this.modules[index].lastDepositAt = Time.now()

    // simulate real deposit && reduce balance
    this.bufferKeys -= keysAmount
    this.balance -= keysAmount * 32

    // console.log('dep', {
    //   allocKeysAmount,
    //   recycledKeysAmount,
    //   'allocation[index]': this.allocation[index],
    //   buf: this.bufferKeys,
    //   keysAmount
    // })
  }

  // debug
}

function tOfs(now = 0) {}

async function main() {
  // add modules
  StakingRouter.addModule(curatedModule)
  StakingRouter.addModule(communityModule2)
  StakingRouter.addModule(communityModule)

  // simulate transfer ether for allocation
  Time.init()

  let amount = 9999
  console.head(`[+${Time.diff()}h] oracleReport() + allocate(), sum ${amount}ETH`)
  Lido.oracleReport(amount)
  // get allocation
  StakingRouter.flushAndAllocate()

  console.hr()
  // simulate deposit in 3h from report
  Time.shift(3)
  let s = getAndPrintState()
  let module_index = 0

  let [keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys`)
  StakingRouter.deposit(module_index, keysAmount) // deposit  keys
  s = getAndPrintState()

  console.hr()
  // simulate 13h pass from report
  Time.shift(13)
  s = getAndPrintState()
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys`)
  StakingRouter.deposit(module_index, keysAmount) // deposit all avail keys
  s = getAndPrintState()

  console.hr()

  // simulate 13h pass from report
  Time.shift(14)
  s = getAndPrintState()
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  // keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  recycledKeysAmount = Math.floor(recycledKeysAmount / 2) // 1/2 of avail recycled keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys, ${recycledKeysAmount} recycled keys`)
  StakingRouter.deposit(module_index, keysAmount + recycledKeysAmount)
  s = getAndPrintState()

  console.hr()

  s = getAndPrintState()
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  // keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  // recycledKeysAmount = Math.floor(recycledKeysAmount / 2) // 1/2 of avail recycled keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys, ${recycledKeysAmount} recycled keys`)
  StakingRouter.deposit(module_index, keysAmount + recycledKeysAmount)
  s = getAndPrintState()

  console.hr()

  Time.shift(25)
  s = getAndPrintState()
  amount = 444
  console.head(`[+${Time.diff()}h] oracleReport() + allocate(), sum ${amount}ETH`)
  Lido.oracleReport(amount)
  StakingRouter.flushAndAllocate()
  s = getAndPrintState()

  console.hr()

  Time.shift(41) // 1d + 17h
  s = getAndPrintState()
  module_index = 1
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  // keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  recycledKeysAmount = Math.floor(recycledKeysAmount / 1.5) // 2/3 of avail recycled keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys, ${recycledKeysAmount} recycled keys`)
  StakingRouter.deposit(module_index, keysAmount + recycledKeysAmount)
  s = getAndPrintState()

  console.hr()

  s = getAndPrintState()
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  // keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  recycledKeysAmount = Math.floor(recycledKeysAmount) // 100% of avail recycled keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys, ${recycledKeysAmount} recycled keys`)
  StakingRouter.deposit(module_index, keysAmount + recycledKeysAmount)
  s = getAndPrintState()

  console.hr()

  Time.shift(48)
  amount = 3333
  console.head(`[+${Time.diff()}h] oracleReport() + allocate(), sum ${amount}ETH`)
  Lido.oracleReport(amount)
  StakingRouter.flushAndAllocate()

  s = getAndPrintState()
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  console.log('!!!', { recycledKeysAmount, keysAmount })
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys, ${recycledKeysAmount} recycled keys`)
  StakingRouter.deposit(module_index, keysAmount + recycledKeysAmount)
  s = getAndPrintState()

  console.hr()
  module_index = 0

  Time.shift(61)
  s = getAndPrintState()
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  // keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  recycledKeysAmount = Math.floor(recycledKeysAmount / 2) // 1/2 of avail recycled keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys, ${recycledKeysAmount} recycled keys`)
  StakingRouter.deposit(module_index, keysAmount + recycledKeysAmount)
  s = getAndPrintState()

  console.hr()

  Time.shift(71)
  amount = 12345
  console.head(`[+${Time.diff()}h] oracleReport() + allocate(), sum ${amount}ETH`)
  Lido.oracleReport(amount)
  StakingRouter.flushAndAllocate()

  Time.shift(85)
  s = getAndPrintState()
  ;[keysAmount, recycledKeysAmount] = StakingRouter.getModuleMaxKeys(module_index)
  // keysAmount = Math.floor(keysAmount / 2) // 1/2 of avail keys
  // recycledKeysAmount = Math.floor(recycledKeysAmount / 2) // 1/2 of avail recycled keys
  console.head(`[+${Time.diff()}h] deposit(), module #${module_index}, ${keysAmount} keys, ${recycledKeysAmount} recycled keys`)
  StakingRouter.deposit(module_index, keysAmount + recycledKeysAmount)
  s = getAndPrintState()
}

console.head = (msg, ...args) => {
  const divider = ''.padStart(Math.max(msg.length, 20), '=')
  console.info(`\n${divider}\n${msg}\n${divider}\n`, ...args)
}

console.hr = (...args) => {
  const divider = ''.padStart(10, '=')
  console.info(`\n${divider} 8< ${divider}\n`, ...args)
}

function getAndPrintState() {
  console.table(StakingRouter.getModules())
  const alloc = StakingRouter.allocation
  console.table(alloc)
  const recycleCache = StakingRouter.getRecycledKeys()
  console.table(recycleCache)
  return { alloc, recycleCache }
}

main().catch(console.error)
