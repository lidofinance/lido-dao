// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../nos/NodeOperatorsRegistry.sol";

contract NodeOperatorsRegistryMock is NodeOperatorsRegistry {
    function increaseDepositedSigningKeysCount(uint24 _nodeOperatorId, uint64 _keysCount) external {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        nodeOperator.depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount.add(_keysCount);

        SigningKeysStats.State memory signingKeysStats = _getTotalSigningKeysStats();
        signingKeysStats.increaseDepositedSigningKeysCount(_keysCount);
        _setTotalSigningKeysStats(signingKeysStats);
    }

    // function setOperatorTotalKeys(uint256 _operatorId, uint64 _keys) external {
    //     operators[_operatorId].totalSigningKeys = _keys;
    // }
    // function incUsedSigningKeys(uint256 _operatorId, uint64 _incDelta) external {
    //     operators[_operatorId].usedSigningKeys += _incDelta;
    //     _setTotalActiveKeys(keysUsageStats.totalActiveKeys.add(uint64(_incDelta)));
    //     _updateTotalAvailableKeysCount();
    // }
    // function setOperatorUsedKeys(uint256 _operatorId, uint64 _keys) external {
    //     operators[_operatorId].usedSigningKeys = _keys;
    // }
    // function setOperatorStoppedKeys(uint256 _operatorId, uint64 _keys) external {
    //     operators[_operatorId].stoppedValidators = _keys;
    // }
    // function setAvailableKeysCount(uint256 _keys) external {
    //     keysUsageStats.totalAvailableKeys = uint64(_keys);
    // }
    // function setActiveKeysCount(uint256 _keys) external {
    //     keysUsageStats.totalActiveKeys = uint64(_keys);
    // }
}
