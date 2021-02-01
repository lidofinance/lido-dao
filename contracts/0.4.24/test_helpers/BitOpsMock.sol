// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../oracle/BitOps.sol";


/**
  * @dev Only for testing purposes! LidoOracle version with some functions exposed.
  */
contract BitOpsMock {
    using BitOps for uint256;

    function getBit(uint256 _mask, uint256 _bitIndex) public pure returns (bool) {
        return _mask.getBit(_bitIndex);
    }

    function setBit(uint256 _mask, uint256 _bitIndex, bool bit) public pure returns (uint256) {
        return _mask.setBit(_bitIndex, bit);
    }

    function popcnt(uint256 _mask) public pure returns (uint256) {
        return _mask.popcnt();
    }
}
