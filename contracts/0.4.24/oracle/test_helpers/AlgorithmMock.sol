// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../Algorithm.sol";


contract AlgorithmMock {
    function modeTest(uint256[] data) public pure returns (bool isUnimodal, uint256 mode) {
        return Algorithm.mode(data);
    }
}
