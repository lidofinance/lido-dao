pragma solidity 0.4.24;

import "../../interfaces/INodeOperatorsRegistry.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract PoolMock {
    event KeysAssigned(bytes pubkeys, bytes signatures);
    event KeysOpIndexSet(uint256 keysOpIndex);

    INodeOperatorsRegistry private operators;

    constructor(address _operators) public {
        operators = INodeOperatorsRegistry(_operators);
    }

    function assignNextSigningKeys(uint256 _numKeys) external {
        (bytes memory pubkeys, bytes memory signatures) = operators.assignNextSigningKeys(_numKeys);
        emit KeysAssigned(pubkeys, signatures);
    }

    function trimUnusedKeys() external {
        operators.trimUnusedKeys();
    }
}
