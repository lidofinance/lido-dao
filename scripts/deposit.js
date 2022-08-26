let proModule = {
    'type': 'PRO',
    'totalKeys': 4000,
    'totalUsedKeys': 3000,
    'totalStoppedKeys': 100,
    'softCap': 0,
    'assignedDeposits': 0 
}

let soloModule = {
    'type': 'SOLO',
    'totalKeys': 100,
    'totalUsedKeys': 10,
    'totalStoppedKeys': 1,
    'softCap': 90,
    'assignedDeposits': 0
}

let soloModule2 = {
    'type': 'SOLO',
    'totalKeys': 200,
    'totalUsedKeys': 20,
    'totalStoppedKeys': 1,
    'softCap': 1,
    'assignedDeposits': 0
}
let soloModule3 = {
    'type': 'SOLO',
    'totalKeys': 1000,
    'totalUsedKeys': 1000,
    'totalStoppedKeys': 100,
    'softCap': 1,
    'assignedDeposits': 0
}



let modules = []
modules.push(proModule)
modules.push(soloModule)
modules.push(soloModule2)
modules.push(soloModule3)

console.table(modules)

let numDeposits = 100000
console.info("deposit", numDeposits)
eth2depositRR(numDeposits)
console.table(modules)

function eth2depositRR(_deposits) {

    totalKeys = 0
    for(i=0; i< modules.length; i++) {
        totalKeys += modules[i].totalKeys
    }

    console.info("total keys in protocol", totalKeys)

    assignedDeposits = 0;
    while(assignedDeposits < _deposits) {
        bestModuleIdx = modules.length

        smallestStake = 0;
        for(i=0; i< modules.length; i++) {

            module = modules[i];

            if (module.totalUsedKeys == module.totalKeys) {
                continue;
            }

            stake = module.totalUsedKeys - module.totalStoppedKeys;

            //check soft cap
            if (module.softCap > 0 && module.assignedDeposits / _deposits * 100 >= module.softCap)
                continue;
            //check module quota

            if (bestModuleIdx == modules.length || stake < smallestStake) {
                bestModuleIdx = i;
                smallestStake = stake;
            }
        }

        if (bestModuleIdx == modules.length)  // not found
                break;

        module = modules[bestModuleIdx]
        module.totalUsedKeys++
        module.assignedDeposits++
        assignedDeposits++

    }

}


