// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "../interfaces/IBeaconReportReceiver.sol";

/**
  * @title Mock helper for the `CompositePostRebaseBeaconReceiver` tests.
  *
  * @dev DON'T USE THIS CODE IN A PRODUCTION
  */
contract BeaconReceiverMock is IBeaconReportReceiver {
    uint256 public immutable id;
    uint256 public processedCounter;

    constructor(uint256 _id) {
        id = _id;
    }

    function processLidoOracleReport(uint256, uint256, uint256) external override {
        processedCounter++;
    }
}
