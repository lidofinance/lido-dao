// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {NodeOperatorsRegistry} from "../munged/NodeOperatorsRegistry.sol";
import {Packed64x4} from "../../contracts/0.4.24/lib/Packed64x4.sol";

contract NodeOperatorsRegistryHarness is NodeOperatorsRegistry {
    using Packed64x4 for Packed64x4.Packed;

    uint256 public test_nodeId;
    uint256[] public myActiveKeyCountsAfterAllocation;

    /// @dev DEPRECATED use addSigningKeys instead
    function addSigningKeysOperatorBH(uint256, uint256, bytes, bytes) external {}

    /// @dev DEPRECATED use removeSigningKeys instead
    function removeSigningKey(uint256, uint256) external {}

    /// @dev DEPRECATED use removeSigningKeys instead
    function removeSigningKeyOperatorBH(uint256, uint256) external {}

    /// @dev DEPRECATED use removeSigningKeys instead
    function removeSigningKeysOperatorBH(uint256 _nodeOperatorId, uint256 _fromIndex, uint256 _keysCount) external {}
    
    function _auth(bytes32 _role) internal view {
        _requireAuth(_canPerformNoParams(msg.sender, _role));
    }

    function _authP(bytes32 _role, uint256[]) internal view {
        _requireAuth(_canPerformNoParams(msg.sender, _role));
    }

    function _canPerformNoParams(address sender, bytes32 ) private view returns (bool) {
        return sender != 0;
    }

    function getSigningKeysAllocationDataPerNode(
        uint256 _depositsCount, uint256 index) 
        public view returns (uint256, uint256, uint256) {
        (
            uint256 allocated,
            uint256[] memory nodeOperatorIds,
            uint256[] memory activeKeysCountAfterAllocation
        ) = _getSigningKeysAllocationData(_depositsCount);
        
        return (allocated, nodeOperatorIds[index], activeKeysCountAfterAllocation[index]);
    }

    function loadAllocatedSigningKeys(uint256 _keysCountToLoad) public returns (uint256, uint256) {
        uint256[] memory nodeOperatorIds = new uint256[](getNodeOperatorsCount());
        for (uint256 i; i < nodeOperatorIds.length; ++i) {
            nodeOperatorIds[i] = i;
        }
        if(_keysCountToLoad == 0) return (0,0);
        (bytes memory pubkeys, bytes memory signatures) = 
            _loadAllocatedSigningKeys(_keysCountToLoad,nodeOperatorIds,myActiveKeyCountsAfterAllocation);
        return (pubkeys.length, signatures.length);
    }

    function loadKeysHelper() public view returns (uint256) {
        uint256 count = getNodeOperatorsCount();
        uint256 allocated = 0;
        require (myActiveKeyCountsAfterAllocation.length == count);
        for (uint256 i; i < count; ++i) {
            (uint256 exitedSigningKeysCount, uint256 depositedSigningKeysCount ,uint256 maxSigningKeysCount) = _getNodeOperator(i);
            allocated += myActiveKeyCountsAfterAllocation[i] - (depositedSigningKeysCount - exitedSigningKeysCount);
            require(myActiveKeyCountsAfterAllocation[i] <= maxSigningKeysCount - exitedSigningKeysCount);
            require(myActiveKeyCountsAfterAllocation[i] >= depositedSigningKeysCount - exitedSigningKeysCount);
        }
        return allocated;
    }

    function updateExitedValidatorsCount(uint256 nodeOperatorId, uint64 validatorsCount) external {
        _auth(STAKING_ROUTER_ROLE);
        uint256 totalNodeOperatorsCount = getNodeOperatorsCount();
        _requireValidRange(nodeOperatorId < totalNodeOperatorsCount);
        require (test_nodeId == nodeOperatorId);
        _updateExitedValidatorsCount(nodeOperatorId, validatorsCount, false);
    }

    function updateStuckValidatorsCount(uint256 nodeOperatorId, uint64 validatorsCount) external {
        _auth(STAKING_ROUTER_ROLE);
        uint256 totalNodeOperatorsCount = getNodeOperatorsCount();
        _requireValidRange(nodeOperatorId < totalNodeOperatorsCount);
        require (test_nodeId == nodeOperatorId);
        _updateStuckValidatorsCount(nodeOperatorId, validatorsCount);
    }

    function getRewardsDistributionShare(uint256 _totalRewardShares, uint256 _nodeOperatorId) 
    public view returns (uint256 sumOfShares, uint256 shareOfId) {
        (, uint256[] memory shares, ) = getRewardsDistribution(_totalRewardShares);

        for (uint256 idx; idx < shares.length; ++idx) {
            sumOfShares += shares[idx];
        }
        shareOfId = shares[_nodeOperatorId];
    }

    function getSummaryTotalExitedValidators() public view returns (uint256) {
        Packed64x4.Packed memory summarySigningKeysStats = _loadSummarySigningKeysStats();
        return summarySigningKeysStats.get(SUMMARY_EXITED_KEYS_COUNT_OFFSET);
    }

    function getSummaryTotalDepositedValidators() public view returns (uint256) {
        Packed64x4.Packed memory summarySigningKeysStats = _loadSummarySigningKeysStats();
        return summarySigningKeysStats.get(SUMMARY_DEPOSITED_KEYS_COUNT_OFFSET);
    }

    function getSummaryTotalKeyCount() public view returns (uint256) {
        Packed64x4.Packed memory summarySigningKeysStats = _loadSummarySigningKeysStats();
        return summarySigningKeysStats.get(SUMMARY_TOTAL_KEYS_COUNT_OFFSET);
    }

    function getSummaryMaxValidators() public view returns (uint256) {
        Packed64x4.Packed memory summarySigningKeysStats = _loadSummarySigningKeysStats();
        return summarySigningKeysStats.get(SUMMARY_MAX_VALIDATORS_COUNT_OFFSET);
    }

    function getNodeOperator_stuckValidators(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        return stuckPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET);
    }

    function getNodeOperator_refundedValidators(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        return stuckPenaltyStats.get(REFUNDED_VALIDATORS_COUNT_OFFSET);
    }

    function getNodeOperator_endTimeStamp(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        return stuckPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET);
    }

    function getNodeOperatorSigningStats_exited(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(TOTAL_EXITED_KEYS_COUNT_OFFSET);
    }

    function getNodeOperatorSigningStats_vetted(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(TOTAL_VETTED_KEYS_COUNT_OFFSET);
    }

    function getNodeOperatorSigningStats_deposited(uint256 _nodeOperatorId) public view returns (uint256) {
       Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
       return signingKeysStats.get(TOTAL_DEPOSITED_KEYS_COUNT_OFFSET);
    }

    function getNodeOperatorSigningStats_total(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);
    }

    function getNodeOperatorTargetStats_target(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory operatorTargetStats = _loadOperatorTargetValidatorsStats(_nodeOperatorId);
        return operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET);
    }

    function getNodeOperatorTargetStats_max(uint256 _nodeOperatorId) public view returns (uint256) {
        Packed64x4.Packed memory operatorTargetStats = _loadOperatorTargetValidatorsStats(_nodeOperatorId);
        return operatorTargetStats.get(MAX_VALIDATORS_COUNT_OFFSET);
    }

    function sumOfExitedKeys() public view returns (uint256 sumOfKeys) {
        for (uint256 i; i < getNodeOperatorsCount(); ++i) {
            sumOfKeys += getNodeOperatorSigningStats_exited(i);
        }
    }

    function sumOfDepositedKeys() public view returns (uint256 sumOfKeys) {
        for (uint256 i; i < getNodeOperatorsCount(); ++i) {
            sumOfKeys += getNodeOperatorSigningStats_deposited(i);
        }
    }

    function sumOfTotalKeys() public view returns (uint256 sumOfKeys) {
        for (uint256 i; i < getNodeOperatorsCount(); ++i) {
            sumOfKeys += getNodeOperatorSigningStats_total(i);
        }
    }

    function sumOfMaxKeys() public view returns (uint256 sumOfKeys) {
        for (uint256 i; i < getNodeOperatorsCount(); ++i) {
            sumOfKeys += getNodeOperatorTargetStats_max(i);
        }
    }

    function sumOfActiveOperators() public view returns (uint256 sumOfActive) {
        for (uint256 operatorId; operatorId < getNodeOperatorsCount(); ++operatorId) {
            if (!getNodeOperatorIsActive(operatorId)) continue;
            sumOfActive++;
        }
    } 
}
