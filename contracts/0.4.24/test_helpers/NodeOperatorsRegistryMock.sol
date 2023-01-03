// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../nos/NodeOperatorsRegistry.sol";

contract NodeOperatorsRegistryMock is NodeOperatorsRegistry {
    function increaseNodeOperatorDepositedSigningKeysCount(uint24 _nodeOperatorId, uint64 _keysCount) external {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        nodeOperator.depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount.add(_keysCount);

        SigningKeysStats.State memory signingKeysStats = _getTotalSigningKeysStats();
        signingKeysStats.increaseDepositedSigningKeysCount(_keysCount);
        _setTotalSigningKeysStats(signingKeysStats);
    }

    function increaseTotalSigningKeysCount(uint256 _keysCount) external {
        SigningKeysStats.State memory signingKeysStats = _getTotalSigningKeysStats();
        signingKeysStats.increaseTotalSigningKeysCount(uint64(_keysCount));
        _setTotalSigningKeysStats(signingKeysStats);
    }

    function increaseDepositedSigningKeysCount(uint256 _keysCount) external {
        SigningKeysStats.State memory signingKeysStats = _getTotalSigningKeysStats();
        signingKeysStats.increaseDepositedSigningKeysCount(uint64(_keysCount));
        _setTotalSigningKeysStats(signingKeysStats);
    }

    function increaseVettedSigningKeysCount(uint256 _keysCount) external {
        SigningKeysStats.State memory signingKeysStats = _getTotalSigningKeysStats();
        signingKeysStats.increaseVettedSigningKeysCount(uint64(_keysCount));
        _setTotalSigningKeysStats(signingKeysStats);
    }

    function testing_resetTotalSigningKeysStats() external {
        SigningKeysStats.State memory signingKeysStats;
        _setTotalSigningKeysStats(signingKeysStats);
    }

    function testing_addNodeOperator(
        string _name,
        address _rewardAddress,
        uint64 totalSigningKeysCount,
        uint64 vettedSigningKeysCount,
        uint64 depositedSigningKeysCount,
        uint64 exitedSigningKeysCount
    ) external returns (uint256 id) {
        id = getNodeOperatorsCount();

        TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(id + 1);

        NodeOperator storage operator = _nodeOperators[id];

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount + 1);

        operator.active = true;
        operator.name = _name;
        operator.rewardAddress = _rewardAddress;
        operator.totalSigningKeysCount = totalSigningKeysCount;
        operator.vettedSigningKeysCount = vettedSigningKeysCount;
        operator.depositedSigningKeysCount = depositedSigningKeysCount;
        operator.exitedSigningKeysCount = exitedSigningKeysCount;

        emit NodeOperatorAdded(id, _name, _rewardAddress, 0);
    }

    function testing_getTotalSigningKeysStats()
        external
        view
        returns (
            uint256 totalSigningKeysCount,
            uint256 vettedSigningKeysCount,
            uint256 depositedSigningKeysCount,
            uint256 exitedSigningKeysCount
        )
    {
        SigningKeysStats.State memory signingKeysStats = _getTotalSigningKeysStats();
        totalSigningKeysCount = signingKeysStats.totalSigningKeysCount;
        vettedSigningKeysCount = signingKeysStats.vettedSigningKeysCount;
        depositedSigningKeysCount = signingKeysStats.depositedSigningKeysCount;
        exitedSigningKeysCount = signingKeysStats.exitedSigningKeysCount;
    }

    function testing_setBaseVersion(uint256 _newBaseVersion) external {
        CONTRACT_VERSION_POSITION.setStorageUint256(_newBaseVersion);
    }
}
