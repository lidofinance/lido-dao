pragma solidity 0.4.24;

import "../../interfaces/INodeOperatorsRegistry.sol";
import {IStakingModule} from "../../interfaces/IStakingModule.sol";

/**
 * @dev This is a mock. Don't use in production.
 */
contract PoolMock {
    event KeysAssigned(uint256 keysCount, bytes pubkeys, bytes signatures);

    IStakingModule private operators;

    constructor(address _operators) public {
        operators = IStakingModule(_operators);
    }

    function assignNextSigningKeys(uint64 _numKeys) external {
        bytes memory data = new bytes(0);
        (uint256 enqueuedValidatorsKeysCount, bytes memory pubkeys, bytes memory signatures) = operators.requestValidatorsKeysForDeposits(
            _numKeys,
            data
        );
        emit KeysAssigned(enqueuedValidatorsKeysCount, pubkeys, signatures);
    }

    function trimUnusedKeys() external {
        operators.invalidateReadyToDepositKeys();
    }
}
