// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
import {UnstructuredStorage} from "@aragon/os/contracts/common/UnstructuredStorage.sol";

library ValidatorsKeysStats {
    using SafeMath64 for uint64;

    /// @dev Validator usage stats
    struct State {
        uint64 approvedValidatorsKeysCount;
        /// @dev Number of keys in the EXITED state for this operator for all time
        uint64 exitedValidatorsKeysCount;
        /// @dev Total number of keys of this operator for all time
        uint64 totalValidatorsKeysCount;
        /// @dev Number of keys of this operator which were in DEPOSITED state for all time
        uint64 depositedValidatorsKeysCount;
    }

    uint256 private constant APPROVED_VALIDATORS_KEYS_COUNT_OFFSET = 0;
    uint256 private constant EXITED_VALIDATORS_KEYS_COUNT_OFFSET = 64;
    uint256 private constant TOTAL_VALIDATORS_KEYS_COUNT_OFFSET = 128;
    uint256 private constant DEPOSITED_VALIDATORS_KEYS_COUNT_OFFSET = 192;

    function increaseApprovedValidatorsKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.approvedValidatorsKeysCount = _validatorsStats.approvedValidatorsKeysCount.add(_increment);
    }

    function decreaseApprovedValidatorsKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.approvedValidatorsKeysCount = _validatorsStats.approvedValidatorsKeysCount.sub(_decrement);
    }

    function increaseExitedValidatorsKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.exitedValidatorsKeysCount = _validatorsStats.exitedValidatorsKeysCount.add(_increment);
    }

    function decreaseExitedValidatorsKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.exitedValidatorsKeysCount = _validatorsStats.exitedValidatorsKeysCount.sub(_decrement);
    }

    function increaseTotalValidatorsKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.totalValidatorsKeysCount = _validatorsStats.totalValidatorsKeysCount.add(_increment);
    }

    function decreaseTotalValidatorsKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.depositedValidatorsKeysCount = _validatorsStats.depositedValidatorsKeysCount.sub(_decrement);
    }

    function increaseDepositedValidatorsKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.approvedValidatorsKeysCount = _validatorsStats.approvedValidatorsKeysCount.add(_increment);
    }

    function decreaseDepositedValidatorsKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.approvedValidatorsKeysCount = _validatorsStats.approvedValidatorsKeysCount.sub(_decrement);
    }

    function load(bytes32 _position) internal view returns (State memory) {
        uint256 encodedValidatorsStats = UnstructuredStorage.getStorageUint256(_position);
        return _decodeState(encodedValidatorsStats);
    }

    function store(State memory _validatorsStats, bytes32 _position) internal {
        uint256 encodedValidatorsStats = _encodeState(_validatorsStats);
        UnstructuredStorage.setStorageUint256(_position, encodedValidatorsStats);
    }

    function _encodeState(State memory _validatorsStats) private pure returns (uint256) {
        return ((uint256(_validatorsStats.approvedValidatorsKeysCount) << APPROVED_VALIDATORS_KEYS_COUNT_OFFSET) |
            (uint256(_validatorsStats.exitedValidatorsKeysCount) << EXITED_VALIDATORS_KEYS_COUNT_OFFSET) |
            (uint256(_validatorsStats.totalValidatorsKeysCount) << TOTAL_VALIDATORS_KEYS_COUNT_OFFSET) |
            (uint256(_validatorsStats.depositedValidatorsKeysCount) << DEPOSITED_VALIDATORS_KEYS_COUNT_OFFSET));
    }

    function _decodeState(uint256 _encodedValidatorsStats) private pure returns (State memory decodedValidatorsStats) {
        decodedValidatorsStats.approvedValidatorsKeysCount = uint64(_encodedValidatorsStats >> APPROVED_VALIDATORS_KEYS_COUNT_OFFSET);
        decodedValidatorsStats.exitedValidatorsKeysCount = uint64(_encodedValidatorsStats >> EXITED_VALIDATORS_KEYS_COUNT_OFFSET);
        decodedValidatorsStats.totalValidatorsKeysCount = uint64(_encodedValidatorsStats >> TOTAL_VALIDATORS_KEYS_COUNT_OFFSET);
        decodedValidatorsStats.depositedValidatorsKeysCount = uint64(_encodedValidatorsStats >> DEPOSITED_VALIDATORS_KEYS_COUNT_OFFSET);
    }
}
