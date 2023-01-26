// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
import {UnstructuredStorage} from "@aragon/os/contracts/common/UnstructuredStorage.sol";

library SigningKeysStats {
    using SafeMath64 for uint64;

    /// @dev Validator usage stats
    struct State {
        uint64 vettedSigningKeysCount;
        /// @dev Number of keys in the EXITED state for this operator for all time
        uint64 exitedSigningKeysCount;
        /// @dev Total number of keys of this operator for all time
        uint64 totalSigningKeysCount;
        /// @dev Number of keys of this operator which were in DEPOSITED state for all time
        uint64 depositedSigningKeysCount;
    }

    uint256 private constant VETTED_SIGNING_KEYS_COUNT_OFFSET = 0;
    uint256 private constant EXITED_SIGNING_KEYS_COUNT_OFFSET = 64;
    uint256 private constant TOTAL_SIGNING_KEYS_COUNT_OFFSET = 128;
    uint256 private constant DEPOSITED_SIGNING_KEYS_COUNT_OFFSET = 192;

    function increaseVettedSigningKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.vettedSigningKeysCount = _validatorsStats.vettedSigningKeysCount.add(_increment);
    }

    function decreaseVettedSigningKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.vettedSigningKeysCount = _validatorsStats.vettedSigningKeysCount.sub(_decrement);
    }

    function increaseExitedSigningKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.exitedSigningKeysCount = _validatorsStats.exitedSigningKeysCount.add(_increment);
    }

    function decreaseExitedSigningKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.exitedSigningKeysCount = _validatorsStats.exitedSigningKeysCount.sub(_decrement);
    }

    function increaseTotalSigningKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.totalSigningKeysCount = _validatorsStats.totalSigningKeysCount.add(_increment);
    }

    function decreaseTotalSigningKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.totalSigningKeysCount = _validatorsStats.totalSigningKeysCount.sub(_decrement);
    }

    function increaseDepositedSigningKeysCount(State memory _validatorsStats, uint64 _increment) internal pure {
        _validatorsStats.depositedSigningKeysCount = _validatorsStats.depositedSigningKeysCount.add(_increment);
    }

    function decreaseDepositedSigningKeysCount(State memory _validatorsStats, uint64 _decrement) internal pure {
        _validatorsStats.depositedSigningKeysCount = _validatorsStats.depositedSigningKeysCount.sub(_decrement);
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
        return ((uint256(_validatorsStats.vettedSigningKeysCount) << VETTED_SIGNING_KEYS_COUNT_OFFSET) |
            (uint256(_validatorsStats.exitedSigningKeysCount) << EXITED_SIGNING_KEYS_COUNT_OFFSET) |
            (uint256(_validatorsStats.totalSigningKeysCount) << TOTAL_SIGNING_KEYS_COUNT_OFFSET) |
            (uint256(_validatorsStats.depositedSigningKeysCount) << DEPOSITED_SIGNING_KEYS_COUNT_OFFSET));
    }

    function _decodeState(uint256 _encodedValidatorsStats) private pure returns (State memory decodedValidatorsStats) {
        decodedValidatorsStats.vettedSigningKeysCount = uint64(_encodedValidatorsStats >> VETTED_SIGNING_KEYS_COUNT_OFFSET);
        decodedValidatorsStats.exitedSigningKeysCount = uint64(_encodedValidatorsStats >> EXITED_SIGNING_KEYS_COUNT_OFFSET);
        decodedValidatorsStats.totalSigningKeysCount = uint64(_encodedValidatorsStats >> TOTAL_SIGNING_KEYS_COUNT_OFFSET);
        decodedValidatorsStats.depositedSigningKeysCount = uint64(_encodedValidatorsStats >> DEPOSITED_SIGNING_KEYS_COUNT_OFFSET);
    }
}
