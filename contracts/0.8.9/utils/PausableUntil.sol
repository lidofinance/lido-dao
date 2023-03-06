// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "../lib/UnstructuredStorage.sol";


contract PausableUntil {
    using UnstructuredStorage for bytes32;

    /// Contract resume/pause control storage slot
    bytes32 internal constant RESUME_SINCE_TIMESTAMP_POSITION = keccak256("lido.PausableUntil.resumeSinceTimestamp");
    /// Special value for the infinite pause
    uint256 public constant PAUSE_INFINITELY = type(uint256).max;

    /// @notice Emitted when paused by the `pause(duration)` call
    event Paused(uint256 duration);
    /// @notice Emitted when resumed by the `resume` call
    event Resumed();

    error ZeroPauseDuration();
    error PausedExpected();
    error ResumedExpected();
    error ResumeSinceInPast();

    /// @notice Reverts when resumed
    modifier whenPaused() {
        if (!isPaused()) {
            revert PausedExpected();
        }
        _;
    }

    /// @notice Reverts when paused
    modifier whenResumed() {
        if (isPaused()) {
            revert ResumedExpected();
        }
        _;
    }

    /// @notice Returns whether the contract is paused
    function isPaused() public view returns (bool) {
        return block.timestamp < RESUME_SINCE_TIMESTAMP_POSITION.getStorageUint256();
    }

    /// @notice Returns one of:
    ///  - PAUSE_INFINITELY if paused infinitely returns
    ///  - first second when get contract get resumed if paused for specific duration
    ///  - some timestamp in past if not paused
    function getResumeSinceTimestamp() external view returns (uint256) {
        return RESUME_SINCE_TIMESTAMP_POSITION.getStorageUint256();
    }

    function _resume() internal whenPaused {
        RESUME_SINCE_TIMESTAMP_POSITION.setStorageUint256(block.timestamp);

        emit Resumed();
    }

    function _pauseFor(uint256 _duration) internal whenResumed {
        if (_duration == 0) revert ZeroPauseDuration();

        uint256 resumeSince;
        if (_duration == PAUSE_INFINITELY) {
            resumeSince = PAUSE_INFINITELY;
        } else {
            resumeSince = block.timestamp + _duration;
        }

        RESUME_SINCE_TIMESTAMP_POSITION.setStorageUint256(resumeSince);

        emit Paused(_duration);
    }

    function _pauseUntil(uint256 _resumeSince) internal whenResumed {
        if (_resumeSince < block.timestamp) revert ResumeSinceInPast();

        RESUME_SINCE_TIMESTAMP_POSITION.setStorageUint256(_resumeSince);

        emit Paused(_resumeSince - block.timestamp);
    }
}
