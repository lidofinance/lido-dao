pragma solidity 0.4.24;

import "../../interfaces/INodeOperatorsRegistry.sol";
import "../../interfaces/IStakingModule.sol";

/**
 * @dev This is a mock. Don't use in production.
 */
contract PoolMock {
    event KeysAssigned(uint256 keysCount, bytes pubkeys, bytes signatures);
    event KeysOpIndexSet(uint256 keysOpIndex);

    IStakingModule private operators;

    constructor(address _operators) public {
        operators = IStakingModule(_operators);
    }

    function assignNextSigningKeys(uint256 _numKeys) external {
        bytes memory data = new bytes(0);
        (uint256 keysCount, bytes memory pubkeys, bytes memory signatures) = operators.prepNextSigningKeys(_numKeys, data);
        emit KeysAssigned(keysCount, pubkeys, signatures);
    }

    function trimUnusedKeys() external {
        operators.trimUnusedKeys();
    }
}
