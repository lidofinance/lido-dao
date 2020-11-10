pragma solidity 0.4.24;

import "../../interfaces/INodeOperatorsRegistry.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract PoolMock {
    INodeOperatorsRegistry private operators;

    function setApps(address _token, address _oracle, address _operators) external {
        operators = INodeOperatorsRegistry(_operators);
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

    function reportEther2(uint256 _epoch, uint256 _eth2balance) external {
    }

}
