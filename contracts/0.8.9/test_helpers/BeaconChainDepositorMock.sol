// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {BeaconChainDepositor} from "../BeaconChainDepositor.sol";

contract BeaconChainDepositorMock is BeaconChainDepositor {

    constructor(address _depositContract) BeaconChainDepositor(_depositContract) {}
    
    /**
      * @dev Padding memory array with zeroes up to 64 bytes on the right
      * @param _b Memory array of size 32 .. 64
      */
    function pad64(bytes memory _b) public pure returns (bytes memory) {
        return _pad64(_b);
    }

    /**
      * @dev Converting value to little endian bytes and padding up to 32 bytes on the right
      * @param _value Number less than `2**64` for compatibility reasons
      */
    function toLittleEndian64(uint256 _value) public pure returns (uint256 result) {
        return _toLittleEndian64(_value);
    }
}