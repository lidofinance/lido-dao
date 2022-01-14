// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "./interfaces/IOrderedCallbacksArray.sol";

/**
  * @title Contract defining an ordered callbacks array supporting add/insert/remove ops
  *
  * Contract adds permission modifiers ontop of `IOderedCallbacksArray` interface functions.
  * Only the `VOTING` address can invoke storage mutating (add/insert/remove) functions.
  */
contract OrderedCallbacksArray is IOrderedCallbacksArray {
    uint256 public constant MAX_CALLBACKS_COUNT = 16;

    address public immutable VOTING;

    address[] public callbacks;

    modifier onlyVoting() {
        require(msg.sender == VOTING, "MSG_SENDER_MUST_BE_VOTING");
        _;
    }

    constructor(address _voting) {
        require(_voting != address(0), "VOTING_ZERO_ADDRESS");

        VOTING = _voting;
    }

    function callbacksLength() public view override returns (uint256) {
        return callbacks.length;
    }

    function addCallback(address _callback) external override onlyVoting {
        _insertCallback(_callback, callbacks.length);
    }

    function insertCallback(address _callback, uint256 _atIndex) external override onlyVoting {
        _insertCallback(_callback, _atIndex);
    }

    function removeCallback(uint256 _atIndex) external override onlyVoting {
        require(_atIndex < callbacks.length, "INDEX_IS_OUT_OF_RANGE");

        emit CallbackRemoved(callbacks[_atIndex], _atIndex);

        for (uint256 cIndex = _atIndex; cIndex < callbacks.length-1; cIndex++) {
            callbacks[cIndex] = callbacks[cIndex+1];
        }

        callbacks.pop();
    }

    function _insertCallback(address _callback, uint256 _atIndex) private {
        require(_callback != address(0), "RECEIVER_ZERO_ADDRESS");
        require(_atIndex <= callbacks.length, "INDEX_IS_OUT_OF_RANGE");

        emit CallbackAdded(_callback, _atIndex);

        uint256 oldCArrayLength = callbacks.length;
        require(callbacks.length < MAX_CALLBACKS_COUNT, "MAX_CALLBACKS_COUNT_EXCEEDED");

        callbacks.push();

        if (oldCArrayLength > 0) {
            for (uint256 cIndex = oldCArrayLength; cIndex > _atIndex; cIndex--) {
                callbacks[cIndex] = callbacks[cIndex-1];
            }
        }

        callbacks[_atIndex] = _callback;
    }
}
