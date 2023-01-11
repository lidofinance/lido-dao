// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "./lib/AragonUnstructuredStorage.sol";


/**
 * @title Implementation of oracle committee consensus hash reporting
 */
contract CommitteeQuorum {
    using UnstructuredStorage for bytes32;

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event QuorumChanged(uint256 quorum);

    event CommitteeMemberReported(
        uint256 indexed epochId,
        bytes32 reportHash
    );

    event ConsensusReached(
        uint256 indexed epochId,
        bytes32 reportHash
    );

    /// Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    /// Number of exactly the same reports needed to finalize the epoch
    bytes32 internal constant QUORUM_POSITION = keccak256("lido.CommitteeQuorum.quorum");

    uint256 internal constant MEMBER_NOT_FOUND = type(uint256).max;

    /// The value CONSENSUS_HASH_POSITION has if no consensus reached
    bytes32 internal constant NO_CONSENSUS_HASH = bytes32(0);

    /// The bitmask of the oracle members that pushed their reports
    bytes32 internal constant REPORTS_BITMASK_POSITION = keccak256("lido.CommitteeQuorum.reportsBitmask");

    ///! If no consensus reached it is NO_CONSENSUS_INDEX
    bytes32 internal constant CONSENSUS_HASH_POSITION = keccak256("lido.CommitteeQuorum.consensusHash");

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///! SLOT 0: address[] members
    ///! SLOT 1: bytes[] distinctReportHashes
    ///! SLOT 2: bytes32[] distinctReportCounters

    address[] internal members;
    bytes32[] public distinctReportHashes;
    uint16[] public distinctReportCounters;

    /**
     * @notice Return the current reporting bitmap, representing oracles who have already pushed
     * their version of report during the expected epoch
     * @dev Every oracle bit corresponds to the index of the oracle in the current members list
     */
    function getCurrentOraclesReportStatus() external view returns (uint256) {
        return REPORTS_BITMASK_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the current oracle member committee list
     */
    function getOracleMembers() external view returns (address[] memory) {
        return members;
    }

    /**
     * @notice Return the number of exactly the same reports needed to finalize the epoch
     */
    function getQuorum() public view returns (uint256) {
        return QUORUM_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the consensus hash or zero bytes if no consensus
     */
    function getConsensusHash() external view returns (bytes32) {
        return CONSENSUS_HASH_POSITION.getStorageBytes32();
    }

    function _handleMemberReport(address _reporter, uint256 _epochId, bytes32 _reportHash)
        internal
    {
        // make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(_reporter);
        if (index == MEMBER_NOT_FOUND) { revert NotMemberReported(); }

        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        if (bitMask & mask != 0) { revert MemberAlreadyReported(); }
        REPORTS_BITMASK_POSITION.setStorageUint256(bitMask | mask);

        uint256 numDistinctReports = distinctReportHashes.length;

        uint256 i = 0;
        while (i < numDistinctReports && distinctReportHashes[i] != _reportHash) {
            ++i;
        }

        bool isFound = i < numDistinctReports && numDistinctReports > 0;
        if (isFound) {
            distinctReportCounters[i] += 1;
        } else {
            distinctReportHashes.push(_reportHash);
            distinctReportCounters.push(1);
        }

        emit CommitteeMemberReported(_epochId, _reportHash);

        // Check is quorum reached
        if (distinctReportCounters[i] >= QUORUM_POSITION.getStorageUint256()) {
            _updateConsensusHash(_reportHash, _epochId);
        }
    }

    function _checkOnDataDelivery(bytes32 _dataHash, uint256 _epochId, uint256 _expectedEpochId) internal view {
        bytes32 consensusHash = CONSENSUS_HASH_POSITION.getStorageBytes32();
        if (consensusHash == NO_CONSENSUS_HASH) {
            revert CannotDeliverDataIfNoHashConsensus();
        }
        if (_epochId != _expectedEpochId) {
            revert ConsensusEpochAndDataEpochDoNotMatch();
        }
        if (_dataHash != consensusHash) {
            revert ReportDataDoNotMatchConsensusHash(_dataHash, consensusHash);
        }
    }

    function _getQuorumReport(uint256 _quorum) internal view
        returns (bytes32)
    {
        // check most frequent cases first: all reports are the same or no reports yet
        uint256 numDistinctReports = distinctReportHashes.length;
        if (numDistinctReports == 0) {
            return NO_CONSENSUS_HASH;
        } else if (numDistinctReports == 1) {
            if (distinctReportCounters[0] >= _quorum) {
                return 0;
            } else {
                return NO_CONSENSUS_HASH;
            }
        }

        // If there are multiple reports with the same count above quorum we consider
        // committee quorum not reached
        uint256 consensusIndex = 0;
        bool areMultipleMaxReports = false;
        uint16 maxCount = 0;
        uint16 currentCount = 0;
        for (uint256 i = 0; i < numDistinctReports; ++i) {
            currentCount = distinctReportCounters[i];
            if (currentCount >= maxCount) {
                if (currentCount == maxCount) {
                    areMultipleMaxReports = true;
                } else {
                    consensusIndex = i;
                    maxCount = currentCount;
                    areMultipleMaxReports = false;
                }
            }
        }
        // isQuorumReached = maxCount >= _quorum && !areMultipleMaxReports;
        if (!(maxCount >= _quorum && !areMultipleMaxReports)) {
            return distinctReportHashes[consensusIndex];
        }
        return NO_CONSENSUS_HASH;
    }

    function _addOracleMember(address _member) internal {
        if (_member == address(0)) { revert ZeroMemberAddress(); }
        if (MEMBER_NOT_FOUND != _getMemberId(_member)) { revert MemberExists(); }
        if (members.length >= MAX_MEMBERS) { revert TooManyMembers(); }

        members.push(_member);

        emit MemberAdded(_member);
    }

    function _removeOracleMember(address _member) internal {
        uint256 index = _getMemberId(_member);
        if (index == MEMBER_NOT_FOUND) { revert MemberNotFound(); }

        uint256 last = members.length - 1;
        if (index != last) {
            members[index] = members[last];
        }
        members.pop();
        emit MemberRemoved(_member);

        _clearReporting();
    }

    function _setQuorum(uint256 _quorum) internal {
        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);
    }

    function _updateQuorum(uint256 _quorum, uint256 _epochId) internal {
        if (0 == _quorum) { revert QuorumWontBeMade(); }
        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();

        _setQuorum(_quorum);

        if (_quorum < oldQuorum) {
            bytes32 consensusHash = _getQuorumReport(_quorum);
            if (consensusHash != NO_CONSENSUS_HASH) {
                _updateConsensusHash(consensusHash, _epochId);
                CONSENSUS_HASH_POSITION.setStorageBytes32(consensusHash);
                // TODO: emit event (separate the snippet into function)
            }
        }
    }

    /**
     * @notice Return `_member` index in the members list or revert with MemberNotFound error
     */
    function _getMemberId(address _member) internal view returns (uint256) {
        uint256 length = members.length;
        for (uint256 i = 0; i < length; ++i) {
            if (members[i] == _member) {
                return i;
            }
        }
        return MEMBER_NOT_FOUND;
    }

    function _updateConsensusHash(bytes32 _hash, uint256 _epochId) internal {
        CONSENSUS_HASH_POSITION.setStorageBytes32(_hash);
        emit ConsensusReached(_epochId, _hash);
    }

    function _clearReporting() internal {
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        CONSENSUS_HASH_POSITION.setStorageBytes32(NO_CONSENSUS_HASH);
        delete distinctReportHashes;
        delete distinctReportCounters;
    }

    error NotMemberReported();
    error ZeroMemberAddress();
    error MemberNotFound();
    error TooManyMembers();
    error MemberExists();
    error MemberAlreadyReported();
    error QuorumWontBeMade();
    error CannotDeliverDataIfNoHashConsensus();
    error ConsensusEpochAndDataEpochDoNotMatch();
    error ReportDataDoNotMatchConsensusHash(bytes32 dataHash, bytes32 consensusHash);
}
