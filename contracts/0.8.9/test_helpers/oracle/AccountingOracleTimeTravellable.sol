// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;


import { UnstructuredStorage } from "../../lib/UnstructuredStorage.sol";
import { AccountingOracle } from "../../oracle/AccountingOracle.sol";


interface ITimeProvider {
    function getTime() external view returns (uint256);
}


contract AccountingOracleTimeTravellable is AccountingOracle, ITimeProvider {
    using UnstructuredStorage for bytes32;

    constructor(address lido, uint256 secondsPerSlot) AccountingOracle(lido, secondsPerSlot) {
        // allow usage without a proxy for tests
        CONTRACT_VERSION_POSITION.setStorageUint256(0);
    }

    function getTime() external view returns (uint256) {
        return _getTime();
    }

    function _getTime() internal override view returns (uint256) {
        address consensus = CONSENSUS_CONTRACT_POSITION.getStorageAddress();
        return ITimeProvider(consensus).getTime();
    }
}
