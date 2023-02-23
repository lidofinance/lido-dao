// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {NodeOperatorsRegistry} from "../munged/NodeOperatorsRegistry.sol";
import {Packed64x4} from "../../contracts/0.4.24/lib/Packed64x4.sol";

contract NodeOperatorsRegistryHarness is NodeOperatorsRegistry {
    using Packed64x4 for Packed64x4.Packed;

    //uint256[] public rewardDistributionShares;

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

    function _canPerformNoParams(address, bytes32 ) private view returns (bool) {
        return true;
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
        _onlyExistedNodeOperator(_nodeOperatorId);
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        return stuckPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET);
    }

    function getNodeOperator_refundedValidators(uint256 _nodeOperatorId) public view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        return stuckPenaltyStats.get(REFUNDED_VALIDATORS_COUNT_OFFSET);
    }

    function getNodeOperator_endTimeStamp(uint256 _nodeOperatorId) public view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        return stuckPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET);
    }

    function getNodeOperatorSigningStats_exited(uint256 _nodeOperatorId) public view returns (uint64) {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
    }

    function getNodeOperatorSigningStats_vetted(uint256 _nodeOperatorId) public view returns (uint64) {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET);
    }

    function getNodeOperatorSigningStats_deposited(uint256 _nodeOperatorId) public view returns (uint64) {
       Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
       return signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
    }

    function getNodeOperatorSigningStats_total(uint256 _nodeOperatorId) public view returns (uint64) {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);
    }
}
