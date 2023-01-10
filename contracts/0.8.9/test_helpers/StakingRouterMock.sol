// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {StakingRouter} from "../StakingRouter.sol";

contract StakingRouterMock is StakingRouter {
    constructor(address _depositContract) StakingRouter(_depositContract) {
        // unlock impl
        _setContractVersion(0);
    }
}
    