const { __esModule } = require("patch-package/dist/patch/apply");

const curatedModule = {
  name: 'Curated',
  addr: '0x010101010101010101',
  cap: 0,
  paused: false,

  total_keys: 100000, // total amount of signing keys of this operator
  used_keys: 40000, // number of signing keys of this operator which were used in deposits to the Ethereum 2
  stopped_keys: 0, // number of signing keys which stopped validation (e.g. were slashed)
  exited_keys: 0,
  assigned_keys: 0,

  staking_router: {},

  setStakingRouter: function(object) {
    this.staking_router = object
  },

  deposit: function(num_keys) {
    this.staking_router.deposit(0, num_keys)
  }
}

const communityModule = {
  name: 'Community',
  addr: '0x010101010101010101',
  cap: 100,
  paused: false,

  total_keys: 0,
  used_keys: 0,
  stopped_keys: 0,
  exited_keys: 0,
  assigned_keys: 0,

  staking_router: {},
  setStakingRouter: function(object) {
    this.staking_router = object
  },

  deposit: function(num_keys) {
    this.staking_router.deposit(1, num_keys)
  }
}
///////

let Lido = {}
Lido.buffer = 100;

let StakingRouter = {
  //
  // config
  //
  modules: [],
  modulesCount: 0,

  buffer: 0,
  allocation: [],

  last_distribute: 0,

  //
  // functions
  //

  getTotalKeys: function() {
    // calculate total used keys for operators
    let moduleKeys = []
    let totalKeys = 0
    for (let i=0; i < this.modulesCount; i++) {
        moduleKeys[i] = this.modules[i].total_keys;
        totalKeys += moduleKeys[i];
    }

    return [totalKeys, moduleKeys]
  },

  addModule: function(module) {
    // this.modules.push({ name, addr, cap, paused: false })

    // module.setStakingRouter(this)

    this.modules.push(module)
    this.modulesCount++;
  },

  getModules: function() {
    return this.modules
  },

  distributeDeposits: function() {
    let numDeposits = this.buffer / 32

    this.last_distribute = Math.round((new Date).getTime() / 1000)

    let cache = this.getAllocation(numDeposits)

    for(let i=0; i< this.modulesCount; i++)  {
      entry = cache[i];
      this.allocation[i] = cache[i].assigned_keys;
    }

  },

  _loadModuleCache: function() {
    let modules = []

    for(let i=0; i< this.modulesCount; i++) {
      let entry = this.modules[i]
      modules[i] = {}
      modules[i].id = i
      modules[i].name = entry.name
      modules[i].total_keys = entry.total_keys
      modules[i].stopped_keys = entry.stopped_keys
      modules[i].exited_keys = entry.exited_keys
      modules[i].used_keys = entry.used_keys
      modules[i].cap = entry.cap
      modules[i].paused = entry.paused
      modules[i].assigned_keys = 0
    }

    return modules
  },

  getAllocation: function(_numDeposits) {

    let cache = this._loadModuleCache()

    let totalKeys = this.getTotalKeys()[0]

    let assignedDeposits = 0
    while(assignedDeposits < _numDeposits) {
      let bestModuleIdx = this.modulesCount;
      let smallestStake = 0;

      for(let i=0; i < this.modulesCount; i++) {
        let entry = cache[i];

        if (entry.used_keys == entry.total_keys || entry.used_keys + entry.assigned_keys == entry.total_keys) {
          continue;
        }

        if (entry.paused) {
          continue;
        }

        //calculate least stake
        let stake = entry.used_keys - entry.stopped_keys - entry.exited_keys;
        let soft_cap = entry.cap

        let keys_cap = entry.used_keys + entry.assigned_keys

        if (soft_cap > 0 && keys_cap / totalKeys >= soft_cap) {
          continue;
        }


        if (bestModuleIdx == this.modulesCount || stake < smallestStake) {
          bestModuleIdx = i;
          smallestStake = stake;
        }
      }

      if (bestModuleIdx == this.modulesCount)  // not found
        break;

      entry = cache[bestModuleIdx];

      ++entry.assigned_keys;
      ++assignedDeposits;
    }

    return cache
  },

  deposit: function(index, keys) {
    let amount = this.allocation[index]

    // let now = Math.round((new Date()).getTime() / 1000)+13200

    let now = Math.round((new Date()).getTime() / 1000)+63200 //

    if (amount >= keys) {
      this.allocation[index] -= keys
      this.modules[index].used_keys += keys
      this.buffer -= keys * 32

      return keys;
    }

    if (now - this.last_distribute < 86400/2) {
      console.log('no keys')
      return false
    }

    let locked = 100
    let max = 86400

    let left = now - this.last_distribute
    let unlocked = 1 - (locked - left/(max/locked)) / 100

    for (let i=0; i< this.modulesCount; i++) {
      if (i == index) continue;
      if (amount == keys) break;

      let allocation = this.allocation[i]

      //need to round up
      let unlocked_amount = Math.round(allocation * unlocked)
      amount += unlocked_amount

      this.allocation[i] -= unlocked_amount
    }

    this.modules[index].used_keys += amount
    this.buffer -= amount * 32
  }


};


/////////////////////////////////////////////


function main() {
  // add modules
  StakingRouter.addModule(curatedModule)
  StakingRouter.addModule(communityModule)

  curatedModule.setStakingRouter(StakingRouter)
  communityModule.setStakingRouter(StakingRouter)


  // transfer ether for allocation
  StakingRouter.buffer = 100;

  let modules = StakingRouter.getModules()
  console.table(modules)

  let alloc = StakingRouter.getAllocation();

  console.log('')
  console.info('Allocation only with curated module')
  console.table(alloc)

  console.table(StakingRouter)

  console.info('Add keys to community module')
  communityModule.total_keys = 100

  StakingRouter.buffer = 3232
  console.log('')
  console.info('Allocation with 2 modules')
  alloc = StakingRouter.getAllocation(101);
  console.table(alloc)

  //start distribute
  StakingRouter.distributeDeposits()

  let allocation = StakingRouter.allocation
  console.log('allocation1', allocation)
  console.log('last distribute', StakingRouter.last_distribute)

  //community deposited
  communityModule.deposit(3)

  console.log('buffer', StakingRouter.buffer)

  console.log('allocation2', allocation)

  //pro deposited
  curatedModule.deposit(1)

  // StakingRouter.buffer += 32*30

  //yet another allocation
  StakingRouter.distributeDeposits()
  allocation = StakingRouter.allocation
  console.log('allocation3', allocation)


  //try to get next deposit by por from solo
  console.log('try deposit curated again 150 keys')
  curatedModule.deposit(150)

  allocation = StakingRouter.allocation
  console.log('allocation4', allocation)

  alloc = StakingRouter.getAllocation(0);
  console.table('After deposit')
  console.table(alloc)

  StakingRouter.buffer += 14*32
  StakingRouter.distributeDeposits()
  allocation = StakingRouter.allocation
  console.log('allocation5', allocation)

}

// main();
rewards();

function f(timestamp) {
  var d = new Date(timestamp * 1000);
  let y = d.getFullYear()
  let M = d.getMonth()
  let day = d.getDate()
    var h = (d.getHours().toString().length == 1) ? ('0' + d.getHours()) : d.getHours();
    var m = (d.getMinutes().toString().length == 1) ? ('0' + d.getMinutes()) : d.getMinutes();
    var s = (d.getSeconds().toString().length == 1) ? ('0' + d.getSeconds()) : d.getSeconds();

    var time = y +'-' + M +'-' + day + ' ' + h + ':' + m + ':' + s;

    return time;
}

function rewards() {
  let modules = []
  modules.push({ name: 'm1', fee: 5, treasury: 5, keys: 90})
  modules.push({ name: 'm2', fee: 5, treasury: 5, keys: 10})


  let rewards = 1
  let totalKeys = 100

  console.log(rewards)
  console.table(modules)
  let treasuryShares = 0;
  let recipients = []

  for (let index = 0; index < modules.length; index++) {
    let entry = modules[index];

    let moduleShares = (entry.keys / totalKeys) * entry.fee/100
    treasuryShares += (entry.keys / totalKeys) * entry.treasury/100
    entry.moduleShares = moduleShares
  }

  console.table(treasuryShares)
  console.table(modules)
}
