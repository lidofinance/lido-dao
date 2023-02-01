// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../Lido.sol";

/**
 * @dev This is a mock. Don't use in production.
 */
contract OracleMock {
    Lido private pool;

    function setPool(address _pool) external {
        pool = Lido(_pool);
    }

    function reportBeacon(
        uint256 /*_epochId*/,
        uint128 _beaconValidators,
        uint128 _beaconBalance
    ) external {
        pool.handleOracleReport(
            block.timestamp,
            _beaconValidators,
            _beaconBalance,
            0,
            pool.getELRewardsVault().balance,
            0,
            0,
            false
        );
    }
}
