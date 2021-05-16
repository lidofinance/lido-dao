pragma solidity 0.4.24;
pragma experimental ABIEncoderV2;

import "../../interfaces/INodeOperatorsRegistry.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract PoolMock {
    event KeysAssigned(bytes pubkeys, bytes signatures);

    INodeOperatorsRegistry private operators;

    constructor(address _operators) public {
        operators = INodeOperatorsRegistry(_operators);
    }

    function assignNextSigningKeys(INodeOperatorsRegistry.KeysData[] _keysData) public {
        (bytes memory pubkeys, bytes memory signatures) = operators.verifyNextSigningKeys(_keysData);
        emit KeysAssigned(pubkeys, signatures);
    }

    function trimUnusedKeys() external {
        operators.trimUnusedKeys();
    }
}
