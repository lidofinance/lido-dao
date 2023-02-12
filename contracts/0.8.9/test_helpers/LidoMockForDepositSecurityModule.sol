// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

contract LidoMockForDepositSecurityModule {
    event StakingModuleDeposited(uint256 maxDepositsCount, uint24 stakingModuleId, bytes depositCalldata);
    event Deposited(uint256 maxDeposits);

    function deposit(
        uint256 maxDepositsCount,
        uint256 stakingModuleId,
        bytes calldata depositCalldata
    ) external returns(uint256 keysCount) {
        emit StakingModuleDeposited(maxDepositsCount, uint24(stakingModuleId), depositCalldata);
        return maxDepositsCount;
    }
}
