// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {UnstructuredStorage} from "contracts/0.8.9/lib/UnstructuredStorage.sol";
import {ValidatorsExitBusOracle} from "contracts/0.8.9/oracle/ValidatorsExitBusOracle.sol";

contract ValidatorsExitBusOracleMock is ValidatorsExitBusOracle {
  using UnstructuredStorage for bytes32;

  constructor(uint256 secondsPerSlot, uint256 genesisTime, address lidoLocator)
        ValidatorsExitBusOracle(secondsPerSlot, genesisTime, lidoLocator)
    {
        // allow usage without a proxy for tests
        CONTRACT_VERSION_POSITION.setStorageUint256(0);
    }
}