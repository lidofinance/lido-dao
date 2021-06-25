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

    function verifyNextSigningKeys(INodeOperatorsRegistry.KeysData[] _keysData) public {
        operators.verifyNextSigningKeys(_keysData);
    }

    function trimUnusedKeys() external {
        operators.trimUnusedKeys();
    }
}
