// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {StakingRouter} from "contracts/0.8.9/StakingRouter.sol";
import {UnstructuredStorage} from "contracts/0.8.9/lib/UnstructuredStorage.sol";

contract StakingRouterMockForTE is StakingRouter {
    using UnstructuredStorage for bytes32;

    constructor(address _depositContract) StakingRouter(_depositContract) {
        CONTRACT_VERSION_POSITION.setStorageUint256(0);
    }
}
