const { __esModule } = require("patch-package/dist/patch/apply");

const curatedModule = {
  name: 'Curated',
  addr: '0x010101010101010101',
  cap: 0,

  total_keys: 100000, // total amount of signing keys of this operator
  used_keys: 40000, // number of signing keys of this operator which were used in deposits to the Ethereum 2
  stopped_keys: 0, // number of signing keys which stopped validation (e.g. were slashed)
  exited_keys: 0,
  assigned_keys: 0,


}

const communityModule = {
  name: 'Community',
  addr: '0x010101010101010101',
  cap: 100,

  total_keys: 0, 
  used_keys: 0,
  stopped_keys: 0,
  exited_keys: 0,
  assigned_keys: 0,
}
///////

let Lido = {}
Lido.buffer = 100;

let StakingRouter = {
  modules: [],
  modulesCount: 0,

  buffer: 0,
  allocation: [],

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
    this.modules.push(module)
    this.modulesCount++;
  },

  getModules: function() {
    return this.modules
  },

  stakeAllocation: function() {

    let cache = JSON.parse(JSON.stringify(this.modules));

    let totalKeys = this.getTotalKeys()[0]

    let _numDeposits = this.buffer;

    let assignedDeposits = 0
    while(assignedDeposits < _numDeposits) {
      let bestModuleIdx = this.modulesCount;
      let smallestStake = 0;

      for(let i=0; i < this.modulesCount; i++) {
        let entry = cache[i];

        if (entry.used_keys == entry.total_keys || entry.used_keys + entry.assigned_keys == entry.total_keys) {
          continue;
        }

        //calculate least stake
        let stake = entry.used_keys - entry.stopped_keys - entry.exited_keys;
        let soft_cap = entry.cap

        let keys_cap = entry.used_keys + entry.assigned_keys

        if (soft_cap > 0 && keys_cap / totalKeys >= soft_cap) {
          console.log('cap')
          continue;
        }

        // console.table({
        //   i, soft_cap, keys_cap , totalKeys
        // })

        if (bestModuleIdx == this.modulesCount || stake < smallestStake) {
          bestModuleIdx = i;
          smallestStake = stake;
        }

        // console.log('bestModuleIdx', bestModuleIdx)
        // console.log('smallestStake', smallestStake)
      }

      if (bestModuleIdx == this.modulesCount)  // not found
        break;

      entry = cache[bestModuleIdx];

      ++entry.assigned_keys;
      ++assignedDeposits;
    }

    for(let i=0; i < this.modulesCount; i++) {
      this.allocation[i] = cache[i].assigned_keys;
    }

    return this.allocation;
  },

  deposit: function(index, keys) {
    let amount = this.allocation[index]

    if (amount < keys) {
      console.log('cant')
      return false
    }

    this.allocation[index] -= keys
    this.modules[index].used_keys += keys
    this.buffer -= keys
    // let module = this.modules[in]
    // console.log(amount)
  }


  //debug

};


function main() {
  // StakingRouter.addModule(curatedModule.name, curatedModule.addr, curatedModule.cap)

  // add modules
  StakingRouter.addModule(curatedModule)
  StakingRouter.addModule(communityModule)

  // transfer ether for allocation
  StakingRouter.buffer = 100;

  let modules = StakingRouter.getModules()
  console.table(modules)

  let alloc = StakingRouter.stakeAllocation();

  console.log('')
  console.info('Allocation only with curated module')
  console.table(alloc)

  console.table(StakingRouter)

  console.info('Add keys to community module')
  communityModule.total_keys = 100

  StakingRouter.buffer = 1000
  console.log('')
  console.info('Allocation with 2 modules')
  alloc = StakingRouter.stakeAllocation();
  console.table(alloc)


  // deposit
  let module_index = 1
  StakingRouter.deposit(module_index, 2)

  console.table(StakingRouter)
  console.table(StakingRouter.getModules())

  console.table(alloc)


}

main();