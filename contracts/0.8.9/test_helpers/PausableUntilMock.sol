// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import { PausableUntil } from "../utils/PausableUntil.sol";

contract PausableUntilMock is PausableUntil {
    function pause(uint256 _duration) external {
        _pause(_duration);
    }
}