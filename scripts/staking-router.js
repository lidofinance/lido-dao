// modules config
const proModule = {
    type: 0, // PRO
    fee: 500, // in basic points
    treasuryFee: 500, // in basic points
    totalKeys: 100000,
    totalUsedKeys: 0,
    totalStoppedKeys: 0,
    softCap: 0,
    assignedDeposits: 0,
    balance: 0,
    weight: 1,
    ethPerValidator: 32
  }
  
  const soloModule = {
    type: 1, // SOLO
    fee: 500, // in basic points
    treasuryFee: 500, // in basic points
    totalKeys: 100,
    totalUsedKeys: 2,
    totalStoppedKeys: 0,
    softCap: 500,
    assignedDeposits: 0,
    bond: 16,
    balance: 0,
    weight: 3,
    ethPerValidator: 32
  }
  
  // const soloModule2 = {
  //   type: 1, // SOLO
  //   fee: 500, // in basic points
  //   treasuryFee: 500, // in basic points
  //   totalKeys: 200,
  //   totalUsedKeys: 20,
  //   totalStoppedKeys: 1,
  //   softCap: 100,
  //   assignedDeposits: 0,
  //   bond: 10,
  //   balance: 0,
  //   weight: 3,
  //   ethPerValidator: 32
  // }
  // const soloModule3 = {
  //   type: 1, // SOLO
  //   fee: 500, // in basic points
  //   treasuryFee: 500, // in basic points
  //   totalKeys: 1000,
  //   totalUsedKeys: 900,
  //   totalStoppedKeys: 100,
  //   softCap: 100,
  //   assignedDeposits: 0,
  //   bond: 20,
  //   balance: 0,
  //   weight: 3,
  //   ethPerValidator: 32
  // }


const modules = []
modules.push(proModule)
modules.push(soloModule)
// modules.push(soloModule2)
// modules.push(soloModule3)

let Lido = {}
Lido.totalBeaconChain = 0;
Lido.buffered = 0;
Lido.totalSupply = () => Lido.totalBeaconChain + Lido.buffered

let modules2 = []

let data = {}
for(let i=0; i<modules.length;i++) {
    let op = modules[i]

    let TotalKeys = op.totalKeys
    let UsedKeys = op.totalUsedKeys
    let StoppedKeys = op.totalStoppedKeys
    let WithdrawnKeys = 0
    let FreeKeys = TotalKeys - UsedKeys - StoppedKeys - WithdrawnKeys

    let opdata = {
        TotalKeys: TotalKeys.toString() * 1,
        UsedKeys: UsedKeys.toString() * 1,
        StoppedKeys: StoppedKeys.toString() * 1,
        FreeKeys: FreeKeys.toString() * 1,
        Cap: (op.softCap / 10000 * 100),
        MaxCapStake: 0,
        // Weight: op.weight,
        TotalStake: TotalKeys.toString() * 32,
        UsedStake: UsedKeys.toString() * 32,
        EthPerValidator: op.ethPerValidator,
        distributed: 0
      }

    data[`Operator${i}`] = opdata 

    modules2.push(opdata)

    Lido.totalBeaconChain += UsedKeys * 32
}

Lido.buffered = 480

// for(let i=0; i<modules.length;i++) {
//     let entry = modules2[i]
//     let maxCap = Lido.totalSupply() * entry.Cap / 100
//     entry.MaxCapStake = entry.TotalStake <= maxCap ? entry.TotalStake : maxCap
// }

console.table(Lido)
// console.table(data)
// console.table(modules2)

// let tmp1 = getModulesDeposits(Lido.buffered)
// console.table(tmp1)


// let idx = 1
// let stake1 = getStake(idx)
// console.table(stake1)

// deposit(idx)

// console.table(Lido)
// let tmp2 = getModulesDeposits(Lido.buffered)
// console.table(tmp2)


// function deposit(idx) {
//   let stake1 = getStake(idx)
//   let eth = stake1.distributed
  
//   console.log(eth)

//   let entry = modules2[idx]
//   let keys = eth / 32

//   entry.UsedKeys += keys
//   entry.UsedStake += eth 
//   entry.distributed = 0

//   Lido.buffered -= eth
// }


// function getStake(idx) {
//     let table =  getModulesDeposits(Lido.buffered)
//     return table[idx]
// }



// function getModulesDeposits(buffered) {
//   let tmpModules = [...modules2]
//   let modulesCount = tmpModules.length
 
//     let assignedDeposits = 0
//     while(assignedDeposits < buffered) {
//         let bestModuleIdx = modulesCount;
//         let smallestStake = 0;

//         for(let i=0; i<modulesCount;i++) {
//             let entry = tmpModules[i]

//             if (entry.TotalStake == entry.UsedStake + entry.distributed) {
//                 continue;
//             }

//             let ethPerValidator = entry.EthPerValidator
//             // entry.getMaxStake() == 100eth
//             // entry.getMaxKeys() // 1 == 32eth 320eth, 300 ...20eth -> vault()

//             let percent = Math.round(entry.UsedKeys * ethPerValidator / Lido.totalSupply * 100)

//             if (entry.Cap != 0 && entry.Cap <= percent) continue;

//             if (buffered - assignedDeposits - ethPerValidator < 0) continue;

//             let stake = entry.UsedStake - entry.StoppedKeys * ethPerValidator;
//             if (bestModuleIdx == modulesCount || stake < smallestStake) {
//                 bestModuleIdx = i;
//                 smallestStake = stake;
//             }
//         }

//         if (bestModuleIdx == modulesCount)  // not found
//                 break;

//         entry = tmpModules[bestModuleIdx]
//         let ethPerValidator = entry.EthPerValidator

//         entry.distributed += ethPerValidator
//         assignedDeposits += ethPerValidator
        
//     }

//     return tmpModules;
// }

// 900 -32
// 89 - 16
// 179 - 22
// 0 - 12

// надо распределить 1000eth
// 1. пробегаемся по модулям и смотрим наименьший стейк (UsedKeys-stopped)*32
// 2. если 

// total 100keys (100*32-100*16) = 100*ethpervalidaotr= 100*16 = 1600
// used 10 