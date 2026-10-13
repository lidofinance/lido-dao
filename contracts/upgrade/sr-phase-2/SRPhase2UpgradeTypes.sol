// SPDX-FileCopyrightText: 2026 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* solhint-disable one-contract-per-file */

pragma solidity 0.8.25;

/// @notice Every address the SR phase 2 (LIP-38) upgrade touches.
/// @dev `old*` entries are the live contracts the vote replaces; `new*` entries and the bus are deployed by
///      `0600-deploy-sr-phase-2-contracts` before the vote script is built.
struct SRPhase2UpgradeParameters {
    uint256 chainId;
    // governance
    address voting;
    address agent;
    address dualGovernance;
    // locator
    address locator;
    address locatorAdmin;
    address oldLocatorImplementation;
    address newLocatorImplementation;
    // untouched contracts the vote reads or grants roles on
    address validatorsExitBusOracle;
    address circuitBreaker;
    address circuitBreakerCommittee;
    address resealManager;
    // proxies that only get a new implementation
    address stakingRouter;
    address newStakingRouterImpl;
    address withdrawalVault;
    address newWithdrawalVaultImpl;
    // triggerable withdrawals
    address oldTriggerableWithdrawalsGateway;
    address newTriggerableWithdrawalsGateway;
    address triggerableWithdrawalsBus;
    // removed from the protocol
    address validatorExitDelayVerifier;
    // exit balance limit the new gateway is deployed with
    uint256 exitBalanceLimitMaxEth;
    uint256 exitBalanceLimitPerFrameEth;
    uint256 exitBalanceLimitFrameDurationInSec;
}

/// @dev `WithdrawalVault` sits behind `WithdrawalsManagerProxy`, not an `OssifiableProxy`.
interface IWithdrawalsManagerProxy {
    function proxy_getAdmin() external view returns (address);
    function implementation() external view returns (address);
    function proxy_upgradeTo(address newImplementation, bytes memory setupCalldata) external;
}

/// @dev The live locator before the vote still exposes the verifier this upgrade removes.
interface ILidoLocatorWithVerifier {
    function validatorExitDelayVerifier() external view returns (address);
}

interface IWithdrawalVault {
    function TRIGGERABLE_WITHDRAWALS_GATEWAY() external view returns (address);
    function CONSOLIDATION_GATEWAY() external view returns (address);
}

interface ITriggerableWithdrawalsGateway {
    function LOCATOR() external view returns (address);

    function isPaused() external view returns (bool);

    function getExitRequestLimitFullInfo()
        external
        view
        returns (
            uint256 maxExitBalanceEth,
            uint256 balancePerFrameEth,
            uint256 frameDurationInSec,
            uint256 prevExitBalanceEth,
            uint256 currentExitBalanceEth
        );
}

interface ITriggerableWithdrawalsBus {
    function LOCATOR() external view returns (address);

    function unprocessedIntentsCount() external view returns (uint256);
}

interface IStakingRouter {
    function getContractVersion() external view returns (uint256);
}
