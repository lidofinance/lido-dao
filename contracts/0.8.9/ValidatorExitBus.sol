// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import { AccessControlEnumerable } from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

import "./lib/RateLimitUtils.sol";
import "./ReportEpochChecker.sol";
import "./CommitteeQuorum.sol";


contract ValidatorExitBus is CommitteeQuorum, AccessControlEnumerable, ReportEpochChecker {
    using UnstructuredStorage for bytes32;
    using RateLimitUtils for LimitState.Data;
    using LimitUnstructuredStorage for bytes32;

    event ValidatorExitRequest(
        address indexed stakingModule,
        uint256 indexed nodeOperatorId,
        uint256 indexed validatorId,
        bytes validatorPubkey
    );

    event RateLimitSet(
        uint256 maxLimit,
        uint256 limitIncreasePerBlock
    );

    event CommitteeMemberReported(
        address[] stakingModules,
        uint256[] nodeOperatorIds,
        uint256[] validatorIds,
        bytes[] validatorPubkeys,
        uint256 indexed epochId
    );

    event ConsensusReached(
        address[] stakingModules,
        uint256[] nodeOperatorIds,
        uint256[] validatorIds,
        bytes[] validatorPubkeys,
        uint256 indexed epochId
    );

    event ContractVersionSet(uint256 version);

    // ACL

    bytes32 constant public MANAGE_MEMBERS_ROLE = keccak256("MANAGE_MEMBERS_ROLE");
    bytes32 constant public MANAGE_QUORUM_ROLE = keccak256("MANAGE_QUORUM_ROLE");
    bytes32 constant public SET_BEACON_SPEC_ROLE = keccak256("SET_BEACON_SPEC_ROLE");

    // Unstructured storage

    bytes32 internal constant RATE_LIMIT_STATE_POSITION = keccak256("lido.ValidatorExitBus.rateLimitState");

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.ValidatorExitBus.contractVersion");

    bytes32 internal constant TOTAL_EXIT_REQUESTS_POSITION = keccak256("lido.ValidatorExitBus.totalExitRequests");

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///! Inherited from CommitteeQuorum:
    ///! SLOT 0: address[] members
    ///! SLOT 1: bytes[] distinctReports
    ///! SLOT 2: bytes[] distinctReportHashes
    ///! SLOT 3: bytes32[] distinctReportCounters
    ///! Inherited from AccessControlEnumerable:
    ///! SLOT 4: mapping(bytes32 => RoleData) _roles
    ///! SLOT 5: mapping(bytes32 => EnumerableSet.AddressSet) _roleMembers
    ///! Own:
    ///! SLOT 6: mapping(address => mapping (uint256 => uint256)) lastRequestedValidatorIds

    /// (stakingModuleAddress, nodeOperatorId) => lastRequestedValidatorId
    mapping(address => mapping (uint256 => uint256)) public lastRequestedValidatorIds;

    function initialize(
        address _admin,
        uint256 _maxRequestsPerDayE18,
        uint256 _numRequestsLimitIncreasePerBlockE18,
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    ) external
    {
        // Initializations for v0 --> v1
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) {
            revert CanInitializeOnlyOnZeroVersion();
        }
        if (_admin == address(0)) { revert ZeroAdminAddress(); }

        CONTRACT_VERSION_POSITION.setStorageUint256(1);
        emit ContractVersionSet(1);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);

        LimitState.Data memory limitData = RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
        limitData.setLimit(_maxRequestsPerDayE18, _numRequestsLimitIncreasePerBlockE18);
        limitData.setPrevBlockNumber(block.number);
        RATE_LIMIT_STATE_POSITION.setStorageLimitStruct(limitData);
        emit RateLimitSet(_maxRequestsPerDayE18, _numRequestsLimitIncreasePerBlockE18);

        _setQuorum(1);

        _setBeaconSpec(_epochsPerFrame, _slotsPerEpoch, _secondsPerSlot, _genesisTime);

        // set expected epoch to the first epoch for the next frame
        _setExpectedEpochToFirstOfNextFrame();
    }

    /**
     * @notice Return the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    function getTotalExitRequests() external view returns (uint256) {
        return TOTAL_EXIT_REQUESTS_POSITION.getStorageUint256();
    }


    function handleCommitteeMemberReport(
        address[] calldata _stakingModules,
        uint256[] calldata _nodeOperatorIds,
        uint256[] calldata _validatorIds,
        bytes[] calldata _validatorPubkeys,
        uint256 _epochId
    ) external {
        if (_nodeOperatorIds.length != _validatorPubkeys.length) { revert ArraysMustBeSameSize(); }
        if (_stakingModules.length != _validatorPubkeys.length) { revert ArraysMustBeSameSize(); }
        if (_validatorIds.length != _validatorPubkeys.length) { revert ArraysMustBeSameSize(); }
        if (_validatorPubkeys.length == 0) { revert EmptyArraysNotAllowed(); }

        // TODO: maybe check lengths of pubkeys

        BeaconSpec memory beaconSpec = _getBeaconSpec();
        bool hasEpochAdvanced = _validateAndUpdateExpectedEpoch(_epochId, beaconSpec);
        if (hasEpochAdvanced) {
            _clearReporting();
        }

        bytes memory reportBytes = _encodeReport(_stakingModules, _nodeOperatorIds, _validatorIds, _validatorPubkeys, _epochId);
        if (_handleMemberReport(msg.sender, reportBytes)) {
            _reportKeysToEject(_stakingModules, _nodeOperatorIds, _validatorIds, _validatorPubkeys, _epochId, beaconSpec);
        }

        emit CommitteeMemberReported(_stakingModules, _nodeOperatorIds, _validatorIds, _validatorPubkeys, _epochId);
    }


    function testnet_setAdmin(address _newAdmin)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // TODO: remove this temporary function
        _grantRole(DEFAULT_ADMIN_ROLE, _newAdmin);
        _revokeRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }


    function testnet_addAdmin(address _newAdmin)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // TODO: remove this temporary function
        _grantRole(DEFAULT_ADMIN_ROLE, _newAdmin);
    }


    function testnet_assignAllNonAdminRolesTo(address _rolesHolder)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // TODO: remove this temporary function
        _grantRole(MANAGE_MEMBERS_ROLE, _rolesHolder);
        _grantRole(MANAGE_QUORUM_ROLE, _rolesHolder);
        _grantRole(SET_BEACON_SPEC_ROLE, _rolesHolder);
    }


    function setRateLimit(uint256 _maxLimit, uint256 _limitIncreasePerBlock) external {
        _setRateLimit(_maxLimit, _limitIncreasePerBlock);
    }


    function getMaxLimit() external view returns (uint96) {
        LimitState.Data memory state = RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
        return state.maxLimit;
    }


    function getLimitState() external view returns (LimitState.Data memory) {
        return RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
    }


    function getCurrentLimit() external view returns (uint256) {
        return RATE_LIMIT_STATE_POSITION.getStorageLimitStruct().calculateCurrentLimit();
    }

    function getLastRequestedValidatorId(address _stakingModule, uint256 _nodeOperatorId)
        external view returns (uint256)
    {
        return lastRequestedValidatorIds[_stakingModule][_nodeOperatorId];
    }

    /**
     * @notice Set the number of exactly the same reports needed to finalize the epoch to `_quorum`
     */
    function updateQuorum(uint256 _quorum)
        external onlyRole(MANAGE_QUORUM_ROLE)
    {
        (bool isQuorumReached, uint256 reportIndex) = _updateQuorum(_quorum);
        if (isQuorumReached) {
            (
                address[] memory stakingModules,
                uint256[] memory nodeOperatorIds,
                uint256[] memory validatorIds,
                bytes[] memory validatorPubkeys,
                uint256 epochId
            ) = _decodeReport(distinctReports[reportIndex]);
            _reportKeysToEject(stakingModules, nodeOperatorIds, validatorIds, validatorPubkeys, epochId, _getBeaconSpec());
        }
    }

    /**
     * @notice Add `_member` to the oracle member committee list
     */
    function addOracleMember(address _member)
        external onlyRole(MANAGE_MEMBERS_ROLE)
    {
        _addOracleMember(_member);
    }


    /**
     * @notice Remove '_member` from the oracle member committee list
     */
    function removeOracleMember(address _member)
        external onlyRole(MANAGE_MEMBERS_ROLE)
    {
        _removeOracleMember(_member);
    }


    function _reportKeysToEject(
        address[] memory _stakingModules,
        uint256[] memory _nodeOperatorIds,
        uint256[] memory _validatorIds,
        bytes[] memory _validatorPubkeys,
        uint256 _epochId,
        BeaconSpec memory _beaconSpec
    ) internal {
        emit ConsensusReached(_stakingModules, _nodeOperatorIds, _validatorIds, _validatorPubkeys, _epochId);

        _advanceExpectedEpoch(_epochId + _beaconSpec.epochsPerFrame);
        _clearReporting();

        uint256 numKeys = _validatorPubkeys.length;
        LimitState.Data memory limitData = RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
        uint256 currentLimit = limitData.calculateCurrentLimit();
        uint256 numKeysE18 = numKeys * 10**18;
        if (numKeysE18 > currentLimit) { revert RateLimitExceeded(); }
        limitData.updatePrevLimit(currentLimit - numKeysE18);
        RATE_LIMIT_STATE_POSITION.setStorageLimitStruct(limitData);

        // TODO: maybe do some additional report validity sanity checks

        for (uint256 i = 0; i < numKeys; i++) {
            emit ValidatorExitRequest(
                _stakingModules[i],
                _nodeOperatorIds[i],
                _validatorIds[i],
                _validatorPubkeys[i]
            );

            lastRequestedValidatorIds[_stakingModules[i]][_nodeOperatorIds[i]] = _validatorIds[i];
        }

        TOTAL_EXIT_REQUESTS_POSITION.setStorageUint256(
            TOTAL_EXIT_REQUESTS_POSITION.getStorageUint256() + numKeys
        );
    }

    function _setRateLimit(uint256 _maxLimit, uint256 _limitIncreasePerBlock) internal {
        LimitState.Data memory limitData = RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
        limitData.setLimit(_maxLimit, _limitIncreasePerBlock);
        RATE_LIMIT_STATE_POSITION.setStorageLimitStruct(limitData);

        emit RateLimitSet(_maxLimit, _limitIncreasePerBlock);
    }

    function _decodeReport(bytes memory _reportData) internal pure returns (
        address[] memory stakingModules,
        uint256[] memory nodeOperatorIds,
        uint256[] memory validatorIds,
        bytes[] memory validatorPubkeys,
        uint256 epochId
    ) {
        (stakingModules, nodeOperatorIds, validatorIds, validatorPubkeys, epochId)
            = abi.decode(_reportData, (address[], uint256[], uint256[], bytes[], uint256));
    }


    function _encodeReport(
        address[] calldata _stakingModules,
        uint256[] calldata _nodeOperatorIds,
        uint256[] calldata _validatorIds,
        bytes[] calldata _validatorPubkeys,
        uint256 _epochId
    ) internal pure returns (
        bytes memory reportData
    ) {
        reportData = abi.encode(_stakingModules, _nodeOperatorIds, _validatorIds, _validatorPubkeys, _epochId);
    }

    error CanInitializeOnlyOnZeroVersion();
    error ZeroAdminAddress();
    error RateLimitExceeded();
    error ArraysMustBeSameSize();
    error EmptyArraysNotAllowed();

}
