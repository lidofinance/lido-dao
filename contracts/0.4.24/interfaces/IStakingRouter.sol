// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

interface IStakingRouter {
    function getSharesTable() external returns (address[] memory recipients, uint256[] memory moduleShares, uint256 totalShare);
    function deposit(uint256 maxDepositsCount, uint24 stakingModuleId, bytes depositCalldata) external returns(uint256);

    /**
     * @notice Set credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched to `_withdrawalCredentials`
     * @dev Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
     * @param _withdrawalCredentials withdrawal credentials field as defined in the Ethereum PoS consensus specs
     */
    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external;

    /**
     * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
     */
    function getWithdrawalCredentials() external view returns (bytes32);

    function pauseStakingModule(uint24 _stakingModuleId) external;

    function unpauseStakingModule(uint24 _stakingModuleId) external;

    function getStakingModuleIsPaused(uint24 _stakingModuleId) external view returns (bool);

    function getStakingModuleKeysOpIndex(uint24 _stakingModuleId) external view returns (uint256);

    function getStakingModuleLastDepositBlock(uint24 _stakingModuleId) external view returns (uint256);
}
