methods {
    // LidoLocator
    getLocator() => NONDET
    lido() => NONDET
    burner() => NONDET

    // NodeOperatorsRegistry
    _canPerformNoParams(address sender, bytes32 role) => canPerformNoParams(sender, role) 
    canPerform(address, bytes32, uint256[]) => ALWAYS(true)

    // StEth
    sharesOf(address) returns (uint256) => DISPATCHER(true)
    transferShares(address, uint256) returns (uint256) => DISPATCHER(true)
    approve(address, uint256) returns (bool) => DISPATCHER(true)
    transferSharesFrom(address, address, uint256) returns (uint256)  => DISPATCHER(true)

    // Burner
    requestBurnShares(address, uint256) => DISPATCHER(true)
}

function canPerformNoParams(address sender, bytes32 role) returns bool {
    return canPerformGhost[sender][role];
}

ghost mapping(address => mapping(bytes32 => bool)) canPerformGhost;
