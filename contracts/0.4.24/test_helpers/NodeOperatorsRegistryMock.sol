// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../nos/NodeOperatorsRegistry.sol";

contract NodeOperatorsRegistryMock is NodeOperatorsRegistry {
    function _incTotalSigningKeysStatsPos(uint8 _pos, uint256 _diff) private {
        uint256 totalSigningKeysStats = TOTAL_SIGNING_KEYS_STATS.getStorageUint256();
        totalSigningKeysStats = totalSigningKeysStats.inc(_pos, uint64(_diff));
        TOTAL_SIGNING_KEYS_STATS.setStorageUint256(totalSigningKeysStats);
    }

    function _decTotalSigningKeysStatsPos(uint8 _pos, uint256 _diff) private {
        uint256 totalSigningKeysStats = TOTAL_SIGNING_KEYS_STATS.getStorageUint256();
        totalSigningKeysStats = totalSigningKeysStats.dec(_pos, uint64(_diff));
        TOTAL_SIGNING_KEYS_STATS.setStorageUint256(totalSigningKeysStats);
    }

    function increaseNodeOperatorDepositedSigningKeysCount(uint256 _nodeOperatorId, uint64 _keysCount) external {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        nodeOperator.depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount.add(_keysCount);

        _incTotalSigningKeysStatsPos(DEPOSITED_KEYS_COUNT_OFFSET, _keysCount);
    }

    function increaseTotalSigningKeysCount(uint256 _keysCount) external {
        _incTotalSigningKeysStatsPos(TOTAL_KEYS_COUNT_OFFSET, _keysCount);
    }

    function increaseDepositedSigningKeysCount(uint256 _keysCount) external {
        _incTotalSigningKeysStatsPos(DEPOSITED_KEYS_COUNT_OFFSET, _keysCount);
    }

    function increaseVettedSigningKeysCount(uint256 _keysCount) external {
        _incTotalSigningKeysStatsPos(VETTED_KEYS_COUNT_OFFSET, _keysCount);
    }

    function testing_markAllKeysDeposited() external {
        uint256 nodeOperatorsCount = getNodeOperatorsCount();
        for (uint256 i = 0; i < nodeOperatorsCount; ++i) {
            NodeOperator storage nodeOperator = _nodeOperators[i];
            testing_setDepositedSigningKeysCount(i, nodeOperator.vettedSigningKeysCount);
        }
    }

    function testing_markAllKeysDeposited(uint256 _nodeOperatorId) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        testing_setDepositedSigningKeysCount(_nodeOperatorId, nodeOperator.vettedSigningKeysCount);
    }

    function testing_setDepositedSigningKeysCount(uint256 _nodeOperatorId, uint256 _depositedSigningKeysCount) public {
        _onlyExistedNodeOperator(_nodeOperatorId);
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        uint64 depositedSigningKeysCountBefore = nodeOperator.depositedSigningKeysCount;
        if (_depositedSigningKeysCount == depositedSigningKeysCountBefore) {
            return;
        }

        require(
            _depositedSigningKeysCount <= nodeOperator.vettedSigningKeysCount, "DEPOSITED_SIGNING_KEYS_COUNT_TOO_HIGH"
        );
        require(
            _depositedSigningKeysCount >= nodeOperator.exitedSigningKeysCount, "DEPOSITED_SIGNING_KEYS_COUNT_TOO_LOW"
        );
        nodeOperator.depositedSigningKeysCount = uint64(_depositedSigningKeysCount);

        if (_depositedSigningKeysCount > depositedSigningKeysCountBefore) {
            _incTotalSigningKeysStatsPos(
                DEPOSITED_KEYS_COUNT_OFFSET, (uint64(_depositedSigningKeysCount) - depositedSigningKeysCountBefore)
            );
        } else {
            _decTotalSigningKeysStatsPos(
                DEPOSITED_KEYS_COUNT_OFFSET, (uint64(_depositedSigningKeysCount) - depositedSigningKeysCountBefore)
            );
        }
        emit DepositedSigningKeysCountChanged(_nodeOperatorId, _depositedSigningKeysCount);
        _increaseValidatorsKeysNonce();
    }

    function testing_resetTotalSigningKeysStats() public {
        TOTAL_SIGNING_KEYS_STATS.setStorageUint256(0);
    }

    function testing_unsafeDeactivateNodeOperator(uint256 _nodeOperatorId) external {
        NodeOperator storage operator = _nodeOperators[_nodeOperatorId];
        operator.active = false;
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

    function testing_setNodeOperatorLimits(
        uint256 _nodeOperatorId,
        uint64 stuckValidatorsCount,
        uint64 forgivenValidatorsCount,
        uint64 stuckPenaltyEndAt
    ) external {
        uint256 stcukPenaltyStats = _getOperatorStuckPenaltyStats(_nodeOperatorId);
        stcukPenaltyStats.set(STUCK_VALIDATORS_COUNT_OFFSET, stuckValidatorsCount);
        stcukPenaltyStats.set(FORGIVEN_VALIDATORS_COUNT_OFFSET, forgivenValidatorsCount);
        stcukPenaltyStats.set(STUCK_PENALTY_END_TIMESTAMP_OFFSET, stuckPenaltyEndAt);
        _setOperatorStuckPenaltyStats(_nodeOperatorId, stcukPenaltyStats);
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
        uint256 totalSigningKeysStats = TOTAL_SIGNING_KEYS_STATS.getStorageUint256();
        totalSigningKeysCount = totalSigningKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);
        vettedSigningKeysCount = totalSigningKeysStats.get(VETTED_KEYS_COUNT_OFFSET);
        depositedSigningKeysCount = totalSigningKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
        exitedSigningKeysCount = totalSigningKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
    }

    function testing_setBaseVersion(uint256 _newBaseVersion) external {
        _setContractVersion(_newBaseVersion);
    }

    function testing_resetRegistry() external {
        uint256 totalOperatorsCount = TOTAL_OPERATORS_COUNT_POSITION.getStorageUint256();
        TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(0);
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(0);
        KEYS_OP_INDEX_POSITION.setStorageUint256(0);

        for (uint256 i = 0; i < totalOperatorsCount; ++i) {
            _nodeOperators[i] = NodeOperator(false, address(0), new string(0), 0, 0, 0, 0);
        }

        testing_resetTotalSigningKeysStats();
    }

    function testing_getSigningKeysAllocationData(uint256 _keysCount)
        external
        view
        returns (
            uint256 allocatedKeysCount,
            uint256[] memory nodeOperatorIds,
            uint256[] memory activeKeyCountsAfterAllocation,
            uint256[] memory exitedSigningKeysCount
        )
    {
        return _getSigningKeysAllocationData(_keysCount);
    }

    function testing_requestValidatorsKeysForDeposits(uint256 _keysToAllocate)
        external
        returns (uint256 loadedValidatorsKeysCount, bytes memory publicKeys, bytes memory signatures)
    {
        (loadedValidatorsKeysCount, publicKeys, signatures) =
            this.requestValidatorsKeysForDeposits(_keysToAllocate, new bytes(0));
        emit ValidatorsKeysLoaded(loadedValidatorsKeysCount, publicKeys, signatures);
    }

    function testing_isNodeOperatorPenalized(uint256 operatorId) external view returns (bool) {
        uint256 stcukPenaltyStats = _getOperatorStuckPenaltyStats(operatorId);
        if (
            stcukPenaltyStats.get(FORGIVEN_VALIDATORS_COUNT_OFFSET)
                < stcukPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET)
                || block.timestamp <= stcukPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET)
        ) {
            return true;
        }
        return false;
    }

    event ValidatorsKeysLoaded(uint256 count, bytes publicKeys, bytes signatures);

    function distributeRewards() external returns (uint256) {
        return _distributeRewards();
    }
}
