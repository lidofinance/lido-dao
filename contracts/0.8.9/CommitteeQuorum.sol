// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./lib/AragonUnstructuredStorage.sol";


/**
 * @title Implementation of oracle committee consensus reporting
 */
contract CommitteeQuorum {
    using UnstructuredStorage for bytes32;

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event QuorumChanged(uint256 quorum);

    /// Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    /// Number of exactly the same reports needed to finalize the epoch
    bytes32 internal constant QUORUM_POSITION = keccak256("lido.CommitteeQuorum.quorum");

    uint256 internal constant MEMBER_NOT_FOUND = type(uint256).max;

    /// The bitmask of the oracle members that pushed their reports
    bytes32 internal constant REPORTS_BITMASK_POSITION = keccak256("lido.CommitteeQuorum.reportsBitmask");

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///! SLOT 0: address[] members
    ///! SLOT 1: bytes[] distinctReports
    ///! SLOT 2: bytes[] distinctReportHashes
    ///! SLOT 3: bytes32[] distinctReportCounters

    address[] internal members;
    bytes[] internal distinctReports;
    bytes32[] internal distinctReportHashes;
    uint16[] internal distinctReportCounters;

    /**
     * @notice Return the current reporting bitmap, representing oracles who have already pushed
     * their version of report during the expected epoch
     * @dev Every oracle bit corresponds to the index of the oracle in the current members list
     */
    function getCurrentOraclesReportStatus() external view returns (uint256) {
        return REPORTS_BITMASK_POSITION.getStorageUint256();
    }

    /**
     * @notice Return number of distinct reported
     */
    function getDistinctMemberReportsCount() external view returns (uint256) {
        return distinctReports.length;
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


    function _handleMemberReport(address _reporter, bytes memory _report)
        internal returns (bool isQuorumReached)
    {
        // make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(_reporter);
        if (index == MEMBER_NOT_FOUND) { revert NotMemberReported(); }

        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        if (bitMask & mask != 0) { revert MemberAlreadyReported(); }
        REPORTS_BITMASK_POSITION.setStorageUint256(bitMask | mask);

        bytes32 reportHash = keccak256(_report);
        isQuorumReached = false;

        uint256 i = 0;
        bool isFound = false;
        while (i < distinctReports.length && distinctReportHashes[i] != reportHash) {
            ++i;
        }
        while (i < distinctReports.length) {
            if (distinctReportHashes[i] == reportHash) {
                isFound = true;
                break;
            }
            ++i;
        }

        if (isFound && i < distinctReports.length) {
            distinctReportCounters[i] += 1;
        } else {
            distinctReports.push(_report);
            distinctReportHashes.push(reportHash);
            distinctReportCounters.push(1);
        }

        // Check is quorum reached
        if (distinctReportCounters[i] >= QUORUM_POSITION.getStorageUint256()) {
            isQuorumReached = true;
        }
    }


    function _getQuorumReport(uint256 _quorum) internal view
        returns (bool isQuorumReached, uint256 reportIndex)
    {
        // check most frequent cases first: all reports are the same or no reports yet
        if (distinctReports.length == 0) {
            return (false, 0);
        } else if (distinctReports.length == 1) {
            return (distinctReportCounters[0] >= _quorum, 0);
        }

        // If there are multiple reports with the same count above quorum we consider
        // committee quorum not reached
        reportIndex = 0;
        bool areMultipleMaxReports = false;
        uint16 maxCount = 0;
        uint16 currentCount = 0;
        for (uint256 i = 0; i < distinctReports.length; ++i) {
            currentCount = distinctReportCounters[i];
            if (currentCount >= maxCount) {
                if (currentCount == maxCount) {
                    areMultipleMaxReports = true;
                } else {
                    reportIndex = i;
                    maxCount = currentCount;
                    areMultipleMaxReports = false;
                }
            }
        }
        isQuorumReached = maxCount >= _quorum && !areMultipleMaxReports;
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

        // delete the data for the last epoch, let remained oracles report it again
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        delete distinctReports;
    }

    function _setQuorum(uint256 _quorum) internal {
        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);
    }

    function _updateQuorum(uint256 _quorum) internal
        returns (bool isQuorumReached, uint256 reportIndex)
    {
        if (0 == _quorum) { revert QuorumWontBeMade(); }
        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();

        _setQuorum(_quorum);

        if (_quorum < oldQuorum) {
            return _getQuorumReport(_quorum);
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

    function _clearReporting() internal {
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        delete distinctReports;
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

}
