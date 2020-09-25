pragma solidity 0.4.24;

import "@depools/dao/contracts/interfaces/IStakingProvidersRegistry.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract PoolMock {
    IStakingProvidersRegistry private sps;

    constructor(address _sps) public {
        sps = IStakingProvidersRegistry(_sps);
    }

    function updateUsedKeys(uint256[] _ids, uint64[] _usedSigningKeys) external {
        sps.updateUsedKeys(_ids, _usedSigningKeys);
    }
}
