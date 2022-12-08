// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "./lib/AragonUnstructuredStorage.sol";


/**
 * @title Implementation of an ETH 2.0 -> ETH oracle
 *
 * The goal of the oracle is to inform other parts of the system about balances controlled by the
 * DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down
 * because of slashing.
 *
 * The timeline is divided into consecutive frames. Every oracle member may push its report once
 * per frame. When the equal reports reach the configurable 'quorum' value, this frame is
 * considered finalized and the resulting report is pushed to Lido.
 *
 * Not all frames may come to a quorum. Oracles may report only to the first epoch of the frame and
 * only if no quorum is reached for this epoch yet.
 */
contract CommitteeQuorum {
    using UnstructuredStorage for bytes32;

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event QuorumChanged(uint256 quorum);

    /// Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    /// Contract structured storage
    address[] internal members;                /// slot 0: oracle committee members
    bytes[] internal distinctReports;  /// slot 1: reporting storage
    bytes32[] internal distinctReportHashes;
    uint16[] internal distinctReportCounters;

    /// Number of exactly the same reports needed to finalize the epoch
    bytes32 internal constant QUORUM_POSITION =
        0xd43b42c1ba05a1ab3c178623a49b2cdb55f000ec70b9ccdba5740b3339a7589e; // keccak256("lido.LidoOracle.quorum")

    uint256 internal constant MEMBER_NOT_FOUND = type(uint256).max;

    // Errors
    string private constant ERROR_NOT_MEMBER_REPORTED = "NOT_MEMBER_REPORTED";
    string private constant ERROR_ZERO_MEMBER_ADDRESS = "ZERO_MEMBER_ADDRESS";
    string private constant ERROR_MEMBER_NOT_FOUND = "MEMBER_NOT_FOUND";
    string private constant ERROR_TOO_MANY_MEMBERS = "TOO_MANY_MEMBERS";
    string private constant ERROR_MEMBER_EXISTS = "MEMBER_EXISTS";

    /// The bitmask of the oracle members that pushed their reports
    bytes32 internal constant REPORTS_BITMASK_POSITION =
        0xea6fa022365e4737a3bb52facb00ddc693a656fb51ffb2b4bd24fb85bdc888be; // keccak256("lido.LidoOracle.reportsBitMask")

    /**
     * @notice Return the current reporting bitmap, representing oracles who have already pushed
     * their version of report during the expected epoch
     * @dev Every oracle bit corresponds to the index of the oracle in the current members list
     */
    function getCurrentOraclesReportStatus() external view returns (uint256) {
        return REPORTS_BITMASK_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the current reporting variants array size
     * TODO: rename
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

    function _addOracleMember(address _member) internal {
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _getMemberId(_member), ERROR_MEMBER_EXISTS);
        require(members.length < MAX_MEMBERS, ERROR_TOO_MANY_MEMBERS);

        members.push(_member);

        emit MemberAdded(_member);
    }


    function _removeOracleMember(address _member) internal {
        uint256 index = _getMemberId(_member);
        require(index != MEMBER_NOT_FOUND, ERROR_MEMBER_NOT_FOUND);
        uint256 last = members.length - 1;
        if (index != last) members[index] = members[last];
        members.pop();
        emit MemberRemoved(_member);

        // delete the data for the last epoch, let remained oracles report it again
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        delete distinctReports;
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

        // If there are multiple reports with the same count above quorum number we consider
        // the quorum not reached
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

    function _setQuorum(uint256 _quorum) internal {
        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);
    }

    function _updateQuorum(uint256 _quorum) internal
        returns (bool isQuorumReached, uint256 reportIndex)
    {
        require(0 != _quorum, "QUORUM_WONT_BE_MADE");
        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();

        _setQuorum(_quorum);

        if (_quorum < oldQuorum) {
            return _getQuorumReport(_quorum);
        }
    }

    /**
     * @notice Return `_member` index in the members list or MEMBER_NOT_FOUND
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


    function _handleMemberReport(address _reporter, bytes memory _report)
        internal returns (bool isQuorumReached)
    {
        // make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(_reporter);
        require(index != MEMBER_NOT_FOUND, ERROR_MEMBER_NOT_FOUND);
        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        require(bitMask & mask == 0, "ALREADY_SUBMITTED");
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

}
