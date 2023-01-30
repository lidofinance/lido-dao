// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../nos/NodeOperatorsRegistry.sol";

contract NodeOperatorsRegistryMock is NodeOperatorsRegistry {
    function increaseNodeOperatorDepositedSigningKeysCount(uint256 _nodeOperatorId, uint64 _keysCount) external {
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

        require(_depositedSigningKeysCount <= nodeOperator.vettedSigningKeysCount, "DEPOSITED_SIGNING_KEYS_COUNT_TOO_HIGH");
        require(_depositedSigningKeysCount >= nodeOperator.exitedSigningKeysCount, "DEPOSITED_SIGNING_KEYS_COUNT_TOO_LOW");
        nodeOperator.depositedSigningKeysCount = uint64(_depositedSigningKeysCount);
        SigningKeysStats.State memory signingKeysStats = _getTotalSigningKeysStats();
        if (_depositedSigningKeysCount > depositedSigningKeysCountBefore) {
            signingKeysStats.increaseDepositedSigningKeysCount(uint64(_depositedSigningKeysCount) - depositedSigningKeysCountBefore);
        } else {
            signingKeysStats.decreaseDepositedSigningKeysCount(uint64(_depositedSigningKeysCount) - depositedSigningKeysCountBefore);
        }
        emit DepositedSigningKeysCountChanged(_nodeOperatorId, _depositedSigningKeysCount);
        _increaseValidatorsKeysNonce();
    }

    function testing_resetTotalSigningKeysStats() public {
        SigningKeysStats.State memory signingKeysStats;
        _setTotalSigningKeysStats(signingKeysStats);
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
        bool targetValidatorsLimitActive,
        uint64 targetValidatorsKeysCount,
        uint64 unavaliableKeysCount,
        uint64 stuckSigningKeysCount,
        uint64 forgivenSigningKeysCount 
    ) external {

        NodeOperatorLimit storage operatorLimit = _nodeOperatorsLimits[_nodeOperatorId];

        operatorLimit.targetValidatorsLimitActive = targetValidatorsLimitActive;
        operatorLimit.targetValidatorsKeysCount = targetValidatorsKeysCount;
        operatorLimit.unavaliableKeysCount = unavaliableKeysCount;
        operatorLimit.stuckSigningKeysCount = stuckSigningKeysCount;
        operatorLimit.forgivenSigningKeysCount = forgivenSigningKeysCount;
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
        returns (
            uint256 loadedValidatorsKeysCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {
        (loadedValidatorsKeysCount, publicKeys, signatures) = this.requestValidatorsKeysForDeposits(_keysToAllocate, new bytes(0));
        emit ValidatorsKeysLoaded(loadedValidatorsKeysCount, publicKeys, signatures);
    }

    function testing_isNodeOperatorPenalized(uint256 operatorId) external view returns(bool) {
        NodeOperatorLimit memory nodeOperatorLimit = _nodeOperatorsLimits[operatorId];
        if (nodeOperatorLimit.forgivenSigningKeysCount < nodeOperatorLimit.stuckSigningKeysCount) {
            return true;
        }
        return false;
    }

    event ValidatorsKeysLoaded(uint256 count, bytes publicKeys, bytes signatures);
}
