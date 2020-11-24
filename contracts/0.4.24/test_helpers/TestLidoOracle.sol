// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../oracle/LidoOracle.sol";


/**
  * @dev Only for testing purposes! LidoOracle version with some functions exposed.
  */
contract TestLidoOracle is LidoOracle {
    uint256 private time;

    function setTime(uint256 _time) public {
        time = _time;
    }

    function _getTime() internal view returns (uint256) {
        return time;
    }
}
