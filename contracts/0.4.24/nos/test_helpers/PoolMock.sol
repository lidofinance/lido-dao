pragma solidity 0.4.24;

import "../../interfaces/INodeOperatorsRegistry.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract PoolMock {
    INodeOperatorsRegistry private operators;

    constructor(address _sps) public {
        operators = INodeOperatorsRegistry(_sps);
    }

    function updateUsedKeys(uint256[] _ids, uint64[] _usedSigningKeys) external {
        operators.updateUsedKeys(_ids, _usedSigningKeys);
    }

    function trimUnusedKeys() external {
        operators.trimUnusedKeys();
    }

    function distributeRewards(address _token, uint256 _totalReward) external {
        operators.distributeRewards(_token, _totalReward);
    }
}
