using NodeOperatorsRegistry as nos

methods {
    // Node
    nos.getStakingModuleSummary() 

    // LidoLocator
    lido() => NONDET
    burner() => NONDET

    // NodeOperatorsRegistry
    hasPermission(address, address, bytes32, bytes) returns (bool) => NONDET 
    canPerform(address, bytes32, uint256[]) => NONDET 

    // StEth
    sharesOf(address) returns (uint256) => DISPATCHER(true)
    transferShares(address, uint256) returns (uint256) => DISPATCHER(true)
    approve(address, uint256) returns (bool) => DISPATCHER(true)
    transferSharesFrom(address, address, uint256) returns (uint256)  => DISPATCHER(true)

    // Burner
    requestBurnShares(address, uint256) => DISPATCHER(true)
}
