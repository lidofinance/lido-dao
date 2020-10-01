pragma solidity 0.4.24;

import "../../interfaces/IStakingProvidersRegistry.sol";


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

    function trimUnusedKeys() external {
        sps.trimUnusedKeys();
    }

    function distributeRewards(address _token, uint256 _totalReward) external {
        sps.distributeRewards(_token, _totalReward);
    }
}
