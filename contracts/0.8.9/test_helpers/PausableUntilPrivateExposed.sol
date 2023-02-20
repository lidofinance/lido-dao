// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {PausableUntil} from "../utils/PausableUntil.sol";

contract PausableUntilPrivateExposed is PausableUntil {

    function stubUnderModifierWhenPaused() external view whenPaused returns (uint256) {
        return 42;
    }

    function stubUnderModifierWhenResumed() external view whenResumed returns (uint256) {
        return 42;
    }

    function resume() external {
        _resume();
    }

    function pause(uint256 _duration) external {
        _pause(_duration);
    }

}
