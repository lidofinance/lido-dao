// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.4.24;

import {NodeOperatorsRegistry} from "contracts/0.4.24/nos/NodeOperatorsRegistry.sol";
import {Packed64x4} from "contracts/0.4.24/lib/Packed64x4.sol";

contract NodeOperatorsRegistry__MockForFlow is NodeOperatorsRegistry {
  function mock__increaseNodeOperatorDepositedSigningKeysCount(uint256 _nodeOperatorId, uint64 _keysCount) external {
    Packed64x4.Packed memory signingKeysStats = _nodeOperators[_nodeOperatorId].signingKeysStats;
    signingKeysStats.set(
      TOTAL_DEPOSITED_KEYS_COUNT_OFFSET,
      signingKeysStats.get(TOTAL_DEPOSITED_KEYS_COUNT_OFFSET) + _keysCount
    );
    _nodeOperators[_nodeOperatorId].signingKeysStats = signingKeysStats;

    Packed64x4.Packed memory totalSigningKeysStats = _loadSummarySigningKeysStats();
    totalSigningKeysStats.set(
      TOTAL_DEPOSITED_KEYS_COUNT_OFFSET,
      totalSigningKeysStats.get(TOTAL_DEPOSITED_KEYS_COUNT_OFFSET).add(_keysCount)
    );
    _saveSummarySigningKeysStats(totalSigningKeysStats);

    _updateSummaryMaxValidatorsCount(_nodeOperatorId);
  }

  function mock__markAllKeysDeposited() external {
    uint256 nodeOperatorsCount = getNodeOperatorsCount();
    Packed64x4.Packed memory signingKeysStats;
    for (uint256 i; i < nodeOperatorsCount; ++i) {
      signingKeysStats = _loadOperatorSigningKeysStats(i);
      mock__setDepositedSigningKeysCount(i, signingKeysStats.get(TOTAL_VETTED_KEYS_COUNT_OFFSET));
    }
  }

  function mock__markAllKeysDeposited(uint256 _nodeOperatorId) external {
    _onlyExistedNodeOperator(_nodeOperatorId);
    Packed64x4.Packed memory signingKeysStats = _nodeOperators[_nodeOperatorId].signingKeysStats;
    mock__setDepositedSigningKeysCount(_nodeOperatorId, signingKeysStats.get(TOTAL_VETTED_KEYS_COUNT_OFFSET));
  }

  function mock__setDepositedSigningKeysCount(uint256 _nodeOperatorId, uint256 _depositedSigningKeysCount) public {
    _onlyExistedNodeOperator(_nodeOperatorId);
    // NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
    Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
    uint256 depositedSigningKeysCountBefore = signingKeysStats.get(TOTAL_DEPOSITED_KEYS_COUNT_OFFSET);
    if (_depositedSigningKeysCount == depositedSigningKeysCountBefore) {
      return;
    }

    require(
      _depositedSigningKeysCount <= signingKeysStats.get(TOTAL_VETTED_KEYS_COUNT_OFFSET),
      "DEPOSITED_SIGNING_KEYS_COUNT_TOO_HIGH"
    );
    require(
      _depositedSigningKeysCount >= signingKeysStats.get(TOTAL_EXITED_KEYS_COUNT_OFFSET),
      "DEPOSITED_SIGNING_KEYS_COUNT_TOO_LOW"
    );

    signingKeysStats.set(TOTAL_DEPOSITED_KEYS_COUNT_OFFSET, uint64(_depositedSigningKeysCount));
    _saveOperatorSigningKeysStats(_nodeOperatorId, signingKeysStats);

    emit DepositedSigningKeysCountChanged(_nodeOperatorId, _depositedSigningKeysCount);
    _increaseValidatorsKeysNonce();
  }

  function mock__unsafeDeactivateNodeOperator(uint256 _nodeOperatorId) external {
    NodeOperator storage operator = _nodeOperators[_nodeOperatorId];
    operator.active = false;
  }

  function mock__addNodeOperator(
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
    signingKeysStats.set(TOTAL_DEPOSITED_KEYS_COUNT_OFFSET, depositedSigningKeysCount);
    signingKeysStats.set(TOTAL_VETTED_KEYS_COUNT_OFFSET, vettedSigningKeysCount);
    signingKeysStats.set(TOTAL_EXITED_KEYS_COUNT_OFFSET, exitedSigningKeysCount);
    signingKeysStats.set(TOTAL_KEYS_COUNT_OFFSET, totalSigningKeysCount);

    operator.signingKeysStats = signingKeysStats;

    Packed64x4.Packed memory operatorTargetStats;
    operatorTargetStats.set(MAX_VALIDATORS_COUNT_OFFSET, vettedSigningKeysCount);
    operator.targetValidatorsStats = operatorTargetStats;

    emit NodeOperatorAdded(id, _name, _rewardAddress, 0);

    Packed64x4.Packed memory summarySigningKeysStats = _loadSummarySigningKeysStats();
    summarySigningKeysStats.add(SUMMARY_MAX_VALIDATORS_COUNT_OFFSET, vettedSigningKeysCount);
    summarySigningKeysStats.add(SUMMARY_EXITED_KEYS_COUNT_OFFSET, exitedSigningKeysCount);
    summarySigningKeysStats.add(SUMMARY_TOTAL_KEYS_COUNT_OFFSET, totalSigningKeysCount);
    summarySigningKeysStats.add(SUMMARY_DEPOSITED_KEYS_COUNT_OFFSET, depositedSigningKeysCount);
    _saveSummarySigningKeysStats(summarySigningKeysStats);
  }

  function mock__setNodeOperatorLimits(
    uint256 _nodeOperatorId,
    uint64 stuckValidatorsCount,
    uint64 refundedValidatorsCount,
    uint64 stuckPenaltyEndAt
  ) external {
    Packed64x4.Packed memory stuckPenaltyStats = _nodeOperators[_nodeOperatorId].stuckPenaltyStats;
    stuckPenaltyStats.set(STUCK_VALIDATORS_COUNT_OFFSET, stuckValidatorsCount);
    stuckPenaltyStats.set(REFUNDED_VALIDATORS_COUNT_OFFSET, refundedValidatorsCount);
    stuckPenaltyStats.set(STUCK_PENALTY_END_TIMESTAMP_OFFSET, stuckPenaltyEndAt);
    _nodeOperators[_nodeOperatorId].stuckPenaltyStats = stuckPenaltyStats;
    _updateSummaryMaxValidatorsCount(_nodeOperatorId);
  }

  function mock__getTotalSigningKeysStats()
    external
    view
    returns (
      uint256 totalSigningKeysCount,
      uint256 maxValidatorsCount,
      uint256 depositedSigningKeysCount,
      uint256 exitedSigningKeysCount
    )
  {
    Packed64x4.Packed memory summarySigningKeysStats = _loadSummarySigningKeysStats();
    totalSigningKeysCount = summarySigningKeysStats.get(SUMMARY_TOTAL_KEYS_COUNT_OFFSET);
    maxValidatorsCount = summarySigningKeysStats.get(SUMMARY_MAX_VALIDATORS_COUNT_OFFSET);
    depositedSigningKeysCount = summarySigningKeysStats.get(SUMMARY_DEPOSITED_KEYS_COUNT_OFFSET);
    exitedSigningKeysCount = summarySigningKeysStats.get(SUMMARY_EXITED_KEYS_COUNT_OFFSET);
  }

  function mock__setBaseVersion(uint256 _newBaseVersion) external {
    _setContractVersion(_newBaseVersion);
  }

  function mock__resetRegistry() external {
    uint256 totalOperatorsCount = TOTAL_OPERATORS_COUNT_POSITION.getStorageUint256();
    TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(0);
    ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(0);
    KEYS_OP_INDEX_POSITION.setStorageUint256(0);

    _nodeOperatorSummary = NodeOperatorSummary({summarySigningKeysStats: Packed64x4.Packed(0)});

    Packed64x4.Packed memory tmp;
    for (uint256 i = 0; i < totalOperatorsCount; ++i) {
      _nodeOperators[i] = NodeOperator(false, address(0), new string(0), tmp, tmp, tmp);
    }
  }

  function mock__getSigningKeysAllocationData(
    uint256 _keysCount
  )
    external
    view
    returns (
      uint256 allocatedKeysCount,
      uint256[] memory nodeOperatorIds,
      uint256[] memory activeKeyCountsAfterAllocation
    )
  {
    return _getSigningKeysAllocationData(_keysCount);
  }

  function mock__obtainDepositData(
    uint256 _keysToAllocate
  ) external returns (uint256 loadedValidatorsKeysCount, bytes memory publicKeys, bytes memory signatures) {
    (publicKeys, signatures) = this.obtainDepositData(_keysToAllocate, new bytes(0));
    emit ValidatorsKeysLoaded(publicKeys, signatures);
  }

  function mock__isNodeOperatorPenalized(uint256 operatorId) external view returns (bool) {
    Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(operatorId);
    if (
      stuckPenaltyStats.get(REFUNDED_VALIDATORS_COUNT_OFFSET) < stuckPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET) ||
      block.timestamp <= stuckPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET)
    ) {
      return true;
    }
    return false;
  }

  function mock__getNodeOperator(
    uint256 operatorId
  )
    external
    view
    returns (uint256 exitedSigningKeysCount, uint256 depositedSigningKeysCount, uint256 maxSigningKeysCount)
  {
    return _getNodeOperator(operatorId);
  }

  event ValidatorsKeysLoaded(bytes publicKeys, bytes signatures);

  function mock__distributeRewards() external returns (uint256) {
    return _distributeRewards();
  }

  function mock__setNodeOperatorPenalty(
    uint256 _nodeOperatorId,
    uint256 _refundedValidatorsCount,
    uint256 _stuckValidatorsCount,
    uint256 _stuckPenaltyEndTimestamp
  ) external {
    _requireValidRange(_refundedValidatorsCount <= UINT64_MAX);
    _requireValidRange(_stuckValidatorsCount <= UINT64_MAX);
    _requireValidRange(_stuckPenaltyEndTimestamp <= UINT64_MAX);
    Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);

    stuckPenaltyStats.set(REFUNDED_VALIDATORS_COUNT_OFFSET, uint64(_refundedValidatorsCount));
    stuckPenaltyStats.set(STUCK_VALIDATORS_COUNT_OFFSET, uint64(_stuckValidatorsCount));
    stuckPenaltyStats.set(STUCK_PENALTY_END_TIMESTAMP_OFFSET, uint64(_stuckPenaltyEndTimestamp));
    _saveOperatorStuckPenaltyStats(_nodeOperatorId, stuckPenaltyStats);
    _updateSummaryMaxValidatorsCount(_nodeOperatorId);
  }

  function mock__setLocator(address _mockedLocator) {
    LIDO_LOCATOR_POSITION.setStorageAddress(_mockedLocator);
  }

  function mock__setStuckPenaltyDelay(uint256 _stuckPenaltyDelay) {
    STUCK_PENALTY_DELAY_POSITION.setStorageUint256(_stuckPenaltyDelay);
  }

  function mock__setNonce(uint256 _nonce) {
    KEYS_OP_INDEX_POSITION.setStorageUint256(_nonce);
  }
}
