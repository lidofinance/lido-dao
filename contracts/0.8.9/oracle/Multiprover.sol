// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { AccessControlEnumerable } from "../utils/access/AccessControlEnumerable.sol";

interface LidoZKOracle {
    function getReport(uint256 refSlot) external view returns  (
        bool success,
        uint256 clBalanceGwei,
        uint256 numValidators,
        uint256 exitedValidators
	);
}

contract Multiprover is LidoZKOracle, AccessControlEnumerable {

    error AdminCannotBeZero();

    // zk Oracles commetee
    error DuplicateMember();
    error NonMember();
    error QuorumTooSmall(uint256 minQuorum, uint256 receivedQuorum);
    error AddressCannotBeZero();

    error NoConsensus();

    event MemberAdded(address indexed addr, uint256 newTotalMembers, uint256 newQuorum);
    event MemberRemoved(address indexed addr, uint256 newTotalMembers, uint256 newQuorum);
    event QuorumSet(uint256 newQuorum, uint256 totalMembers, uint256 prevQuorum);

    /// @notice An ACL role granting the permission to modify members list members and
    /// change the quorum by calling addMember, removeMember, and setQuorum functions.
    bytes32 public constant MANAGE_MEMBERS_AND_QUORUM_ROLE =
        keccak256("MANAGE_MEMBERS_AND_QUORUM_ROLE");

    /// @dev Oracle committee members' addresses array
    address[] internal _memberAddresses;

    /// @dev Mapping from an oracle committee member address to the 1-based index in the
    /// members array
    mapping(address => uint256) internal _memberIndices1b;

    /// @dev Oracle committee members quorum value, must be larger than totalMembers // 2
    uint256 internal _quorum;

    constructor(
        address admin
    ) {
        if (admin == address(0)) revert AdminCannotBeZero();

        _setupRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function getIsMember(address addr) external view returns (bool) {
        return _isMember(addr);
    }

    function getMembers() external view returns (
        address[] memory addresses,
        uint256[] memory lastReportedRefSlots
    ) {
        return _getMembers(false);
    }

    function addMember(address addr, uint256 quorum)
        external
        onlyRole(MANAGE_MEMBERS_AND_QUORUM_ROLE)
    {
        _addMember(addr, quorum);
    }

    function removeMember(address addr, uint256 quorum)
        external
        onlyRole(MANAGE_MEMBERS_AND_QUORUM_ROLE)
    {
        _removeMember(addr, quorum);
    }

    function getQuorum() external view returns (uint256) {
        return _quorum;
    }

    function setQuorum(uint256 quorum) external {
        // access control is performed inside the next call
        _setQuorumAndCheckConsensus(quorum, _memberStates.length);
    }

    ///
    /// Implementation: members
    ///

    function _isMember(address addr) internal view returns (bool) {
        return _memberIndices1b[addr] != 0;
    }

    function _getMemberIndex(address addr) internal view returns (uint256) {
        uint256 index1b = _memberIndices1b[addr];
        if (index1b == 0) {
            revert NonMember();
        }
        unchecked {
            return uint256(index1b - 1);
        }
    }

    function _addMember(address addr, uint256 quorum) internal {
        if (_isMember(addr)) revert DuplicateMember();
        if (addr == address(0)) revert AddressCannotBeZero();

        _memberStates.push(MemberState(0, 0));
        _memberAddresses.push(addr);

        uint256 newTotalMembers = _memberStates.length;
        _memberIndices1b[addr] = newTotalMembers;

        emit MemberAdded(addr, newTotalMembers, quorum);

        _setQuorumAndCheckConsensus(quorum, newTotalMembers);
    }

    function _removeMember(address addr, uint256 quorum) internal {
        uint256 index = _getMemberIndex(addr);
        uint256 newTotalMembers = _memberStates.length - 1;

        assert(index <= newTotalMembers);
        MemberState memory memberState = _memberStates[index];

        if (index != newTotalMembers) {
            address addrToMove = _memberAddresses[newTotalMembers];
            _memberAddresses[index] = addrToMove;
            _memberStates[index] = _memberStates[newTotalMembers];
            _memberIndices1b[addrToMove] = index + 1;
        }

        _memberStates.pop();
        _memberAddresses.pop();
        _memberIndices1b[addr] = 0;

        emit MemberRemoved(addr, newTotalMembers, quorum);

        if (memberState.lastReportRefSlot > 0) {
            // member reported at least once
            ConsensusFrame memory frame = _getCurrentFrame();

            if (memberState.lastReportRefSlot == frame.refSlot &&
                _getLastProcessingRefSlot() < frame.refSlot
            ) {
                // member reported for the current ref. slot and the consensus report
                // is not processing yet => need to cancel the member's report
                --_reportVariants[memberState.lastReportVariantIndex].support;
            }
        }

        _setQuorumAndCheckConsensus(quorum, newTotalMembers);
    }

    function _getMembers(bool fastLane) internal view returns (
        address[] memory addresses,
        uint256[] memory lastReportedRefSlots
    ) {
        uint256 totalMembers = _memberStates.length;
        uint256 left;
        uint256 right;

        if (fastLane) {
            (left, right) = _getFastLaneSubset(_getCurrentFrame().index, totalMembers);
        } else {
            right = totalMembers;
        }

        addresses = new address[](right - left);
        lastReportedRefSlots = new uint256[](addresses.length);

        for (uint256 i = left; i < right; ++i) {
            uint256 iModTotal = i % totalMembers;
            MemberState memory memberState = _memberStates[iModTotal];
            uint256 k = i - left;
            addresses[k] = _memberAddresses[iModTotal];
            lastReportedRefSlots[k] = memberState.lastReportRefSlot;
        }
    }

    function _setQuorumAndCheckConsensus(uint256 quorum, uint256 totalMembers) internal {
        if (quorum <= totalMembers / 2) {
            revert QuorumTooSmall(totalMembers / 2 + 1, quorum);
        }

        // we're explicitly allowing quorum values greater than the number of members to
        // allow effectively disabling the oracle in case something unpredictable happens

        uint256 prevQuorum = _quorum;
        if (quorum != prevQuorum) {
            _checkRole(
                quorum == UNREACHABLE_QUORUM ? DISABLE_CONSENSUS_ROLE : MANAGE_MEMBERS_AND_QUORUM_ROLE,
                _msgSender()
            );
            _quorum = quorum;
            emit QuorumSet(quorum, totalMembers, prevQuorum);
        }

        if (_computeEpochAtTimestamp(_getTime()) >= _frameConfig.initialEpoch) {
            _checkConsensus(quorum);
        }
    }


    ///
    /// Implementation: LidoZKOracle
    ///

    function getReport(uint256 refSlot) external view override returns  (
        bool success,
        uint256 clBalanceGwei,
        uint256 numValidators,
        uint256 exitedValidators
    ) {
        return (true, 100, 100, 100);
    }

    ///
    /// Implementation: Auto-resettable fuse
    /// 
}