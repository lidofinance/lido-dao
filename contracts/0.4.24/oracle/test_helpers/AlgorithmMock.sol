// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../Algorithm.sol";


contract AlgorithmMock {
    function frequentTest(uint256[] data, uint256 quorum) public pure returns (bool exists, uint256 mode) {
        return Algorithm.frequent(data, quorum);
    }
}
