// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/introspection/ERC165Checker.sol";
import "@aragon/os/contracts/common/UnstructuredStorage.sol";


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
    using SafeMath for uint256;
    using ERC165Checker for address;
    using UnstructuredStorage for bytes32;

    event MemberAdded(address member);
    event MemberRemoved(address member);
    event QuorumChanged(uint256 quorum);

    /// Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    /// Contract structured storage
    address[] internal members;                /// slot 0: oracle committee members
    bytes[] internal distinctReports;  /// slot 1: reporting storage
    bytes32[] internal distinctReportHashes;
    uint256[] internal distinctReportCounters;

    /// Number of exactly the same reports needed to finalize the epoch
    bytes32 internal constant QUORUM_POSITION =
        0xd43b42c1ba05a1ab3c178623a49b2cdb55f000ec70b9ccdba5740b3339a7589e; // keccak256("lido.LidoOracle.quorum")

    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

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


    // /**
    //  * @notice Return the current reporting variants array size
    //  */
    // function getCurrentReportVariantsSize() external view returns (uint256) {
    //     return currentReportVariants.length;
    // }

    // /**
    //  * @notice Return the current reporting array element with index `_index`
    //  */
    // function getCurrentReportVariant(uint256 _index)
    //     external
    //     view
    //     returns (
    //         uint64 beaconBalance,
    //         uint32 beaconValidators,
    //         uint16 count,
    //         uint32 exitedValidators,
    //         uint40 wcBufferedEther,
    //         uint72 newFinalizedLength
    //     )
    // {
    //     return currentReportVariants[_index].decodeWithCount();
    // }


    // /**
    //  * @notice Return whether the `_quorum` is reached and the final report
    //  */
    // function _getQuorumReport(uint256 _quorum) internal view returns (bool isQuorum, uint256 report) {
    //     // check most frequent cases first: all reports are the same or no reports yet
    //     if (currentReportVariants.length == 1) {
    //         return (currentReportVariants[0].getCount() >= _quorum, currentReportVariants[0]);
    //     } else if (currentReportVariants.length == 0) {
    //         return (false, 0);
    //     }

    //     // if more than 2 kind of reports exist, choose the most frequent
    //     uint256 maxind = 0;
    //     uint256 repeat = 0;
    //     uint16 maxval = 0;
    //     uint16 cur = 0;
    //     for (uint256 i = 0; i < currentReportVariants.length; ++i) {
    //         cur = currentReportVariants[i].getCount();
    //         if (cur >= maxval) {
    //             if (cur == maxval) {
    //                 ++repeat;
    //             } else {
    //                 maxind = i;
    //                 maxval = cur;
    //                 repeat = 0;
    //             }
    //         }
    //     }
    //     return (maxval >= _quorum && repeat == 0, currentReportVariants[maxind]);
    // }

    function _getQuorumReport(uint256 _quorum) internal view returns (bool isQuorum, uint256 reportIndex) {
        // check most frequent cases first: all reports are the same or no reports yet
        if (distinctReports.length == 0) {
            return (false, 0);
        } else if (distinctReports.length == 1) {
            return (distinctReportCounters[0] >= _quorum, 0);
        }

        // TODO: do we need this? maybe return the first report with counter >= quorum?
        uint256 maxReportIndex = 0;
        uint256 maxReportCount = 0;
        for (uint256 i = 1; i < distinctReports.length; ++i) {
            uint256 reportCount = distinctReportCounters[i];
            if (reportCount > maxReportCount) {
                maxReportCount = reportCount;
                maxReportIndex = i;
            }
        }
        return (maxReportCount >= _quorum, maxReportIndex);
    }


    /**
     * @notice Return the current oracle member committee list
     */
    function getOracleMembers() external view returns (address[]) {
        return members;
    }


    function _addOracleMember(address _member) internal {
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _getMemberId(_member), "MEMBER_EXISTS");
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");

        members.push(_member);

        emit MemberAdded(_member);
    }


    function _removeOracleMember(address _member) internal {
        uint256 index = _getMemberId(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 last = members.length - 1;
        if (index != last) members[index] = members[last];
        members.length--;
        emit MemberRemoved(_member);

        // delete the data for the last epoch, let remained oracles report it again
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        delete distinctReports;
    }

    function _setQuorum(uint256 _quorum) internal  {
        require(0 != _quorum, "QUORUM_WONT_BE_MADE");
        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();
        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);
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


    /**
     * @notice Return the number of exactly the same reports needed to finalize the epoch
     */
    function getQuorum() public view returns (uint256) {
        return QUORUM_POSITION.getStorageUint256();
    }

    function _handleMemberReport(address _reporter, bytes _report)
        internal returns (bool isQuorumReached)
    {
        // make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(_reporter);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        require(bitMask & mask == 0, "ALREADY_SUBMITTED");
        REPORTS_BITMASK_POSITION.setStorageUint256(bitMask | mask);


        bytes32 reportHash = keccak256(_report);
        isQuorumReached = false;

        uint256 i = 0;
        while (i < distinctReports.length && distinctReportHashes[i] != reportHash) {
            ++i;
        }
        if (i > 0 && i < distinctReports.length) {
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
