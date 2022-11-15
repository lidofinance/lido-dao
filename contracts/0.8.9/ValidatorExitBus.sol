// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
// pragma experimental ABIEncoderV2;

import "./lib/RateLimitUtils.sol";


contract ValidatorExitBus {
    using RateLimitUtils for LimitState.Data;
    using UnstructuredStorage for bytes32;
    using LimitUnstructuredStorage for bytes32;

    event ValidatorExitRequest(
        uint256 indexed stakingModuleId,
        uint256 indexed nodeOperatorId,
        bytes validatorPubkey
    );

    event RateLimitSet(
        uint256 maxLimit,
        uint256 limitIncreasePerBlock
    );

    event MemberAdded(address member);

    event MemberRemoved(address member);


    string private constant ERROR_ARRAYS_MUST_BE_SAME_SIZE = "ARRAYS_MUST_BE_SAME_SIZE";
    string private constant ERROR_EMPTY_ARRAYS_REPORTED = "EMPTY_ARRAYS_REPORTED";
    string private constant ERROR_NOT_MEMBER_REPORTED = "NOT_MEMBER_REPORTED";
    string private constant ERROR_ZERO_MEMBER_ADDRESS = "ZERO_MEMBER_ADDRESS";
    string private constant ERROR_MEMBER_NOT_FOUND = "MEMBER_NOT_FOUND";
    string private constant ERROR_TOO_MANY_MEMBERS = "TOO_MANY_MEMBERS";
    string private constant ERROR_MEMBER_EXISTS = "MEMBER_EXISTS";

    /// Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    bytes32 internal constant RATE_LIMIT_STATE_POSITION = keccak256("lido.ValidatorExitBus.rateLimitState");

    bytes32 internal constant LAST_REPORT_EPOCH_ID_POSITION = keccak256("lido.ValidatorExitBus.lastReportEpochId");

    /// slot 0: oracle committee members
    address[] private members;

    constructor()
    {
        // For ~450,000 Ethereum validators, max amount of Voluntary Exits processed
        // per epoch is 6. This is 1350 per day
        // Let's assume Lido wants to set its limit for exit request 4 times larger
        // This is 5400 exit requests per day, what is 0.75 requests per block
        // NB, that limit for _enqueuing_ exit requests is much larger (~ 115k per day)
        LimitState.Data memory limit = RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
        limit.setLimit(5400 * 10**18, 75 * 10**16);
        limit.prevBlockNumber = uint32(block.number);
        RATE_LIMIT_STATE_POSITION.setStorageLimitStruct(limit);
    }


    function reportKeysToEject(
        uint256[] calldata stakingModuleIds,
        uint256[] calldata nodeOperatorIds,
        bytes[] calldata validatorPubkeys,
        uint256 epochId
    ) external {
        // TODO: maybe add reporting validator id
        require(nodeOperatorIds.length == validatorPubkeys.length, ERROR_ARRAYS_MUST_BE_SAME_SIZE);
        require(stakingModuleIds.length == validatorPubkeys.length, ERROR_ARRAYS_MUST_BE_SAME_SIZE);
        require(stakingModuleIds.length > 0, ERROR_EMPTY_ARRAYS_REPORTED);

        uint256 memberIndex = _getMemberId(msg.sender);
        require(memberIndex < MAX_MEMBERS, ERROR_NOT_MEMBER_REPORTED);

        if (epochId == LAST_REPORT_EPOCH_ID_POSITION.getStorageUint256()) {
            // no-op for mock version of the contract, to report only on
            // report of the first committee member report
            return;
        }
        LAST_REPORT_EPOCH_ID_POSITION.setStorageUint256(epochId);

        LimitState.Data memory limitData = RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
        uint256 currentLimit = limitData.calculateCurrentLimit();
        uint256 numKeys = nodeOperatorIds.length;
        require(numKeys * 10**18 <= currentLimit, "RATE_LIMIT");
        RATE_LIMIT_STATE_POSITION.setStorageLimitStruct(
            limitData.updatePrevLimit(currentLimit - numKeys)
        );

        for (uint256 i = 0; i < numKeys; i++) {
            emit ValidatorExitRequest(
                stakingModuleIds[i],
                nodeOperatorIds[i],
                validatorPubkeys[i]
            );
        }
    }


    function setRateLimit(uint256 _maxLimit, uint256 _limitIncreasePerBlock) external {
        _setRateLimit(_maxLimit, _limitIncreasePerBlock);
    }


    function getMaxLimit() public view returns (uint96) {
        LimitState.Data memory state = RATE_LIMIT_STATE_POSITION.getStorageLimitStruct();
        return state.maxLimit;
    }


    function getCurrentLimit() public view returns (uint256) {
        return RATE_LIMIT_STATE_POSITION.getStorageLimitStruct().calculateCurrentLimit();
    }

    /**
     * @notice Add `_member` to the oracle member committee list
     */
    function addOracleMember(address _member) external {
        require(_member != address(0), ERROR_ZERO_MEMBER_ADDRESS);
        require(_getMemberId(_member) == MAX_MEMBERS, ERROR_MEMBER_EXISTS);
        require(members.length < MAX_MEMBERS, ERROR_TOO_MANY_MEMBERS);

        members.push(_member);

        emit MemberAdded(_member);
    }

    /**
     * @notice Remove '_member` from the oracle member committee list
     */
    function removeOracleMember(address _member) external {
        uint256 index = _getMemberId(_member);
        require(index != MAX_MEMBERS, ERROR_MEMBER_NOT_FOUND);
        uint256 last = members.length - 1;
        if (index != last) {
            members[index] = members[last];
        }
        members.pop();
        emit MemberRemoved(_member);
    }

    /**
     * @notice Return the current oracle member committee list
     */
    function getOracleMembers() external view returns (address[] memory) {
        return members;
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
        return MAX_MEMBERS;
    }

    function _setRateLimit(uint256 _maxLimit, uint256 _limitIncreasePerBlock) internal {
        RATE_LIMIT_STATE_POSITION.setStorageLimitStruct(
            RATE_LIMIT_STATE_POSITION.getStorageLimitStruct().setLimit(
                _maxLimit,
                _limitIncreasePerBlock
            )
        );

        emit RateLimitSet(_maxLimit, _limitIncreasePerBlock);
    }

}
