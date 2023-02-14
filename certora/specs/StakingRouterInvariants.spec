import "./StakingRouterBase.spec"

/*
    Staking Modules Invariants
    1. Any module address cannot be registered twice.
    2. Different modules cannot have same IDs.
*/

invariant modulesCountIsLastIndex()
    getLastStakingModuleId() == getStakingModulesCount()
    filtered{f -> !isDeposit(f)}

invariant StakingModuleIdLELast(uint256 moduleId)
    getStakingModuleIdById(moduleId) <= getLastStakingModuleId()
    filtered{f -> !isDeposit(f)}

invariant StakingModuleIndexIsIdMinus1(uint256 moduleId)
    getStakingModuleIndexById(moduleId)+1 == getStakingModuleIdById(moduleId)
    filtered{f -> !isDeposit(f)}
    {
        preserved{
            requireInvariant StakingModuleIdLELast(moduleId);
            requireInvariant modulesCountIsLastIndex();
        }
    }

invariant StakingModuleId(uint256 moduleId)
    getStakingModuleIdById(moduleId) == moduleId
    filtered{f -> !isDeposit(f)}
    {
        preserved{
            requireInvariant StakingModuleIndexIsIdMinus1(moduleId);
            requireInvariant StakingModuleIdLELast(moduleId);
            requireInvariant modulesCountIsLastIndex();
        }
    }

invariant StakingModuleIdLECount(uint256 moduleId) 
    getStakingModuleIdById(moduleId) <= getStakingModulesCount()
    filtered{f -> !isDeposit(f)}
    {
        preserved{
            requireInvariant StakingModuleIdLELast(moduleId);
            requireInvariant modulesCountIsLastIndex();
        }
    }

invariant StakingModuleAddressIsNeverZero(uint256 moduleId)
    getStakingModuleIdById(moduleId) <= getLastStakingModuleId() =>
    getStakingModuleAddressById(moduleId) != 0
    filtered{f -> !isDeposit(f)}
    {
        preserved{
            requireInvariant StakingModuleId(moduleId);
        }
    }

invariant StakingModuleAddressIsUnique(uint256 moduleId1, uint256 moduleId2)
    moduleId1 != moduleId2 =>
    differentOrEqualToZero_Address(getStakingModuleAddressById(moduleId1),getStakingModuleAddressById(moduleId2))
    filtered{f -> !isDeposit(f)}
    {
        preserved{
            requireInvariant StakingModuleIdLECount(moduleId1); 
            requireInvariant StakingModuleIdLECount(moduleId2); 
            requireInvariant modulesCountIsLastIndex();
        }
    }

function differentOrEqualToZero_Address(address a, address b) returns bool {
    return a != b || (a == 0 || b == 0);
}

function safeAssumptions(uint256 moduleId) {
    requireInvariant modulesCountIsLastIndex();
    requireInvariant StakingModuleIdLELast(moduleId);
    requireInvariant StakingModuleIndexIsIdMinus1(moduleId);
    requireInvariant StakingModuleId(moduleId);
    requireInvariant StakingModuleIdLECount(moduleId);
    requireInvariant StakingModuleAddressIsNeverZero(moduleId);
}
    
/*
preserved addStakingModule(
            string name, 
            address Address,
            uint256 targetShare,
            uint256 ModuleFee,
            uint256 treasuryFee)
            {
                requireInvariant StakingModuleIdLELast(moduleId);
            }
*/
