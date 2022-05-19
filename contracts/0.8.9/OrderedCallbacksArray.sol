// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/introspection/ERC165Checker.sol";

import "./interfaces/IOrderedCallbacksArray.sol";

/**
  * @title Contract defining an ordered callbacks array supporting add/insert/remove ops
  *
  * Contract adds permission modifiers atop of `IOrderedCallbacksArray` interface functions.
  * Only the `VOTING` address can invoke storage mutating (add/insert/remove) functions.
  */
contract OrderedCallbacksArray is IOrderedCallbacksArray {
    using ERC165Checker for address;

    uint256 public constant MAX_CALLBACKS_COUNT = 16;
    bytes4 constant INVALID_INTERFACE_ID = 0xffffffff;

    address public immutable VOTING;
    bytes4 public immutable REQUIRED_INTERFACE;

    address[] public callbacks;

    modifier onlyVoting() {
        require(msg.sender == VOTING, "MSG_SENDER_MUST_BE_VOTING");
        _;
    }

    constructor(address _voting, bytes4 _requiredIface) {
        require(_requiredIface != INVALID_INTERFACE_ID, "INVALID_IFACE");
        require(_voting != address(0), "VOTING_ZERO_ADDRESS");

        VOTING = _voting;
        REQUIRED_INTERFACE = _requiredIface;
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
        uint256 oldCArrayLength = callbacks.length;
        require(_atIndex < oldCArrayLength, "INDEX_IS_OUT_OF_RANGE");

        emit CallbackRemoved(callbacks[_atIndex], _atIndex);

        for (uint256 cIndex = _atIndex; cIndex < oldCArrayLength-1; cIndex++) {
            callbacks[cIndex] = callbacks[cIndex+1];
        }

        callbacks.pop();
    }

    function _insertCallback(address _callback, uint256 _atIndex) private {
        require(_callback != address(0), "CALLBACK_ZERO_ADDRESS");
        require(_callback.supportsInterface(REQUIRED_INTERFACE), "BAD_CALLBACK_INTERFACE");

        uint256 oldCArrayLength = callbacks.length;
        require(_atIndex <= oldCArrayLength, "INDEX_IS_OUT_OF_RANGE");
        require(oldCArrayLength < MAX_CALLBACKS_COUNT, "MAX_CALLBACKS_COUNT_EXCEEDED");

        emit CallbackAdded(_callback, _atIndex);

        callbacks.push();

        if (oldCArrayLength > 0) {
            for (uint256 cIndex = oldCArrayLength; cIndex > _atIndex; cIndex--) {
                callbacks[cIndex] = callbacks[cIndex-1];
            }
        }

        callbacks[_atIndex] = _callback;
    }
}
