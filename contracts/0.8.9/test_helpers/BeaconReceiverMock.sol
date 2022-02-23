// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import "../interfaces/IBeaconReportReceiver.sol";

/**
  * @title Mock helper for the `CompositePostRebaseBeaconReceiver` tests.
  *
  * @dev DON'T USE THIS CODE IN A PRODUCTION
  */
contract BeaconReceiverMock is IBeaconReportReceiver, ERC165 {
    uint256 public immutable id;
    uint256 public processedCounter;

    constructor(uint256 _id) {
        id = _id;
    }

    function processLidoOracleReport(uint256, uint256, uint256) external virtual override {
        processedCounter++;
    }

    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return (
            _interfaceId == type(IBeaconReportReceiver).interfaceId
            || super.supportsInterface(_interfaceId)
        );
    }
}

contract BeaconReceiverMockWithoutERC165 is IBeaconReportReceiver {
    function processLidoOracleReport(uint256, uint256, uint256) external virtual override {

    }
}
