using NodeOperatorsRegistry as nos
using LidoLocator as locator
using Burner as burner
using LidoMockStEth as lido_

methods {
    // Node
    nos.getStakingModuleSummary() returns (uint256, uint256, uint256)
    nos.finalizeUpgrade_v2(address, bytes32)

    // LidoLocator
    getLocator() => NONDET
    lido() => NONDET
    burner() => NONDET

    // NodeOperatorsRegistry
    canPerform(address sender, bytes32 role, uint256[]) => ALWAYS(true) //canPerformNoParams(sender, role) 

    // StEth
    sharesOf(address) returns (uint256) => DISPATCHER(true)
    transferShares(address, uint256) returns (uint256) => DISPATCHER(true)
    approve(address, uint256) returns (bool) => DISPATCHER(true)
    transferSharesFrom(address, address, uint256) returns (uint256)  => DISPATCHER(true)

    // Burner
    requestBurnShares(address, uint256) => DISPATCHER(true)
}

/*
function canPerformNoParams(address sender, bytes32 role) returns bool {
    return canPerformGhost[sender][role];
}

ghost mapping(address => mapping(bytes32 => bool)) canPerformGhost;
*/

function locatorAddress() returns address {
    return locator;
}

function burnerAddress() returns address {
    return burner;
}

function lidoAddress() returns address {
    return lido_;
}