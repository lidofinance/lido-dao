// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

interface IOrderedCallbacksArray {    
    event CallbackAdded(address indexed callback, uint256 atIndex);
    event CallbackRemoved(address indexed callback, uint256 atIndex);

    function addCallback(address _callback) external;

    function insertCallback(address _callback, uint256 _atIndex) external;

    function removeCallback(uint256 _atIndex) external;
}