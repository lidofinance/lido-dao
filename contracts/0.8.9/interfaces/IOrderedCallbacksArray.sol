// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

/**
  * @title Interface defining an ordered callbacks array supporting add/insert/remove ops
  */
interface IOrderedCallbacksArray {
    /**
      * @notice Callback added event
      *
      * @dev emitted by `addCallback` and `insertCallback` functions
      */
    event CallbackAdded(address indexed callback, uint256 atIndex);

    /**
      * @notice Callback removed event
      *
      * @dev emitted by `removeCallback` function
      */
    event CallbackRemoved(address indexed callback, uint256 atIndex);

    /**
      * @notice Callback length
      * @return Added callbacks count
      */
    function callbacksLength() external view returns (uint256);

    /**
      * @notice Add a `_callback` to the back of array
      * @param _callback callback address
      *
      * @dev cheapest way to insert new item (doesn't incur additional moves)
      */
    function addCallback(address _callback) external;

    /**
      * @notice Insert a `_callback` at the given `_atIndex` position
      * @param _callback callback address
      * @param _atIndex callback insert position
      *
      * @dev insertion gas cost is higher for the lower `_atIndex` values
      */
    function insertCallback(address _callback, uint256 _atIndex) external;

    /**
      * @notice Remove a callback at the given `_atIndex` position
      * @param _atIndex callback remove position
      *
      * @dev remove gas cost is higher for the lower `_atIndex` values
      */
    function removeCallback(uint256 _atIndex) external;

    /**
      * @notice Get callback at position
      * @return Callback at the given `_atIndex`
      *
      * @dev function reverts if `_atIndex` is out of range
      */
    function callbacks(uint256 _atIndex) external view returns (address);
}
