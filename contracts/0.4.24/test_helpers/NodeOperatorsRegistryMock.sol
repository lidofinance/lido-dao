// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../nos/NodeOperatorsRegistry.sol";

contract NodeOperatorsRegistryMock is NodeOperatorsRegistry {
    function _incTotalSigningKeysStatsPos(uint8 _pos, uint256 _diff) private {
        Packed64x4.Packed memory stats = _nodeOperatorTotals.signingKeysStats;
        stats.inc(_pos, uint64(_diff));
        _nodeOperatorTotals.signingKeysStats = stats;
    }

    function _decTotalSigningKeysStatsPos(uint8 _pos, uint256 _diff) private {
        Packed64x4.Packed memory stats = _nodeOperatorTotals.signingKeysStats;
        stats.dec(_pos, uint64(_diff));
        _nodeOperatorTotals.signingKeysStats = stats;
    }

    function _incTotalTargetStatsPos(uint8 _pos, uint256 _diff) private {
        Packed64x4.Packed memory stats = _nodeOperatorTotals.targetValidatorsStats;
        stats.inc(_pos, uint64(_diff));
        _nodeOperatorTotals.targetValidatorsStats = stats;
    }

    function increaseNodeOperatorDepositedSigningKeysCount(uint256 _nodeOperatorId, uint64 _keysCount) external {
        Packed64x4.Packed memory signingKeysStats = _nodeOperators[_nodeOperatorId].signingKeysStats;
        signingKeysStats.inc(DEPOSITED_KEYS_COUNT_OFFSET, _keysCount);
        _nodeOperators[_nodeOperatorId].signingKeysStats = signingKeysStats;

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

    function increaseExitedSigningKeysCount(uint256 _keysCount) external {
        _incTotalSigningKeysStatsPos(EXITED_KEYS_COUNT_OFFSET, _keysCount);
    }

    function increaseTargetValidatorsCount(uint256 _keysCount) external {
        _incTotalTargetStatsPos(TARGET_VALIDATORS_COUNT_OFFSET, _keysCount);
    }

    function increaseExcessValidatorsCount(uint256 _keysCount) external {
        _incTotalTargetStatsPos(EXCESS_VALIDATORS_COUNT_OFFSET, _keysCount);
    }

    function testing_markAllKeysDeposited() external {
        uint256 nodeOperatorsCount = getNodeOperatorsCount();
        Packed64x4.Packed memory signingKeysStats;
        for (uint256 i = 0; i < nodeOperatorsCount; ++i) {
            signingKeysStats = _nodeOperators[i].signingKeysStats;
            testing_setDepositedSigningKeysCount(i, signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET));
        }
    }

    function testing_markAllKeysDeposited(uint256 _nodeOperatorId) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        Packed64x4.Packed memory signingKeysStats = _nodeOperators[_nodeOperatorId].signingKeysStats;
        testing_setDepositedSigningKeysCount(_nodeOperatorId, signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET));
    }

    function testing_setDepositedSigningKeysCount(uint256 _nodeOperatorId, uint256 _depositedSigningKeysCount) public {
        _onlyExistedNodeOperator(_nodeOperatorId);
        // NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        Packed64x4.Packed memory signingKeysStats = _nodeOperators[_nodeOperatorId].signingKeysStats;
        uint64 depositedSigningKeysCountBefore = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
        if (_depositedSigningKeysCount == depositedSigningKeysCountBefore) {
            return;
        }

        require(
            _depositedSigningKeysCount <= signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET),
            "DEPOSITED_SIGNING_KEYS_COUNT_TOO_HIGH"
        );
        require(
            _depositedSigningKeysCount >= signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET), "DEPOSITED_SIGNING_KEYS_COUNT_TOO_LOW"
        );

        signingKeysStats.set(DEPOSITED_KEYS_COUNT_OFFSET, uint64(_depositedSigningKeysCount));
        _nodeOperators[_nodeOperatorId].signingKeysStats = signingKeysStats;

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
        Packed64x4.Packed memory signingKeysStats;
        _nodeOperatorTotals.signingKeysStats = signingKeysStats;
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

        Packed64x4.Packed memory signingKeysStats;
        signingKeysStats.set(DEPOSITED_KEYS_COUNT_OFFSET, depositedSigningKeysCount);
        signingKeysStats.set(VETTED_KEYS_COUNT_OFFSET, vettedSigningKeysCount);
        signingKeysStats.set(EXITED_KEYS_COUNT_OFFSET, exitedSigningKeysCount);
        signingKeysStats.set(TOTAL_KEYS_COUNT_OFFSET, totalSigningKeysCount);
        
        operator.signingKeysStats = signingKeysStats;

        emit NodeOperatorAdded(id, _name, _rewardAddress, 0);
    }

    function testing_setNodeOperatorLimits(
        uint256 _nodeOperatorId,
        uint64 stuckValidatorsCount,
        uint64 forgivenValidatorsCount,
        uint64 stuckPenaltyEndAt
    ) external {
        Packed64x4.Packed memory stcukPenaltyStats = _nodeOperators[_nodeOperatorId].stuckPenaltyStats;
        stcukPenaltyStats.set(STUCK_VALIDATORS_COUNT_OFFSET, stuckValidatorsCount);
        stcukPenaltyStats.set(FORGIVEN_VALIDATORS_COUNT_OFFSET, forgivenValidatorsCount);
        stcukPenaltyStats.set(STUCK_PENALTY_END_TIMESTAMP_OFFSET, stuckPenaltyEndAt);
        _nodeOperators[_nodeOperatorId].stuckPenaltyStats = stcukPenaltyStats;
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
        Packed64x4.Packed memory totalSigningKeysStats = _nodeOperatorTotals.signingKeysStats;
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

        Packed64x4.Packed memory tmp;
        for (uint256 i = 0; i < totalOperatorsCount; ++i) {
            _nodeOperators[i] = NodeOperator(false, address(0), new string(0), tmp, tmp, tmp);
        }
        _nodeOperatorTotals = NodeOperatorTotals(tmp, tmp, tmp);

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
        Packed64x4.Packed memory stcukPenaltyStats = _loadOperatorStuckPenaltyStats(operatorId);
        if (
            stcukPenaltyStats.get(FORGIVEN_VALIDATORS_COUNT_OFFSET) < stcukPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET)
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
