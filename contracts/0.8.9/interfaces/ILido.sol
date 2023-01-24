// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;


interface ILido {
    /**
      * @notice Gets the amount of Ether temporary buffered on this contract balance
      */
    function getBufferedEther() external view returns (uint256);

    function getStakingRouter() external view returns (address);

    function receiveStakingRouter() external payable;

    function handleOracleReport(
        uint256 secondsElapsedSinceLastReport,
        // CL values
        uint256 beaconValidators,
        uint256 beaconBalance,
        // EL values
        uint256 withdrawalVaultBalance,
        uint256 elRewardsVaultBalance,
        // decision
        uint256 requestIdToFinalizeUpTo,
        uint256 finalizationShareRate,
        bool isBunkerMode
    ) external;
}
