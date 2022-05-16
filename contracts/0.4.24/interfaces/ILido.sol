// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


/**
  * @title Liquid staking pool
  *
  * For the high-level description of the pool operation please refer to the paper.
  * Pool manages withdrawal keys and fees. It receives ether submitted by users on the ETH 1 side
  * and stakes it via the deposit_contract.sol contract. It doesn't hold ether on it's balance,
  * only a small portion (buffer) of it.
  * It also mints new tokens for rewards generated at the ETH 2.0 side.
  */
interface ILido {
    function totalSupply() external view returns (uint256);
    function getTotalShares() external view returns (uint256);

    /**
      * @notice Stop pool routine operations
      */
    function stop() external;

    /**
      * @notice Resume pool routine operations
      */
    function resume() external;

    /**
      * @notice Stops accepting new Ether to the protocol.
      *
      * @dev While accepting new Ether is stopped, calls to the `submit` function,
      * as well as to the default payable function, will revert.
      *
      * Emits `StakingPaused` event.
      */
    function pauseStaking() external;

    /**
      * @notice Resumes accepting new Ether to the protocol (if `pauseStaking` was called previously)
      * and updates the staking rate limit.
      * NB: To resume without limits pass zero arg values.
      * @param _maxStakeLimit max stake limit value
      * @param _stakeLimitIncreasePerBlock stake limit increase per single block
      */
    function resumeStaking(uint256 _maxStakeLimit, uint256 _stakeLimitIncreasePerBlock) external;

    /**
      * @notice Check staking state: whether it's paused or not
      */
    function isStakingPaused() external view returns (bool);

    /**
      * @notice Returns how much Ether can be staked in the current block
      * @dev Special return values:
      * - 2^256 - 1 if staking is unlimited;
      * - 0 if staking is paused or if limit is exhausted.
      */
    function getCurrentStakeLimit() external view returns (uint256);

    /**
      * @notice Returns internal info about stake limit
      * @dev Might be used for the advanced integration requests.
      */
    function getStakeLimitInternalInfo() external view returns (
        uint256 maxStakeLimit,
        uint256 maxStakeLimitGrowthBlocks,
        uint256 prevStakeLimit,
        uint256 prevStakeBlockNumber
    );

    event Stopped();
    event Resumed();
    event StakingPaused();
    event StakingResumed(uint256 maxStakeLimit, uint256 stakeLimitIncreasePerBlock);

    /**
      * @notice Set Lido protocol contracts (oracle, treasury, insurance fund).
      * @param _oracle oracle contract
      * @param _treasury treasury contract which accumulates treasury fee
      * @param _insuranceFund insurance fund contract which accumulates insurance fee
      */
    function setProtocolContracts(
        address _oracle,
        address _treasury,
        address _insuranceFund
    ) external;

    event ProtocolContactsSet(address oracle, address treasury, address insuranceFund);

    /**
      * @notice Set fee rate to `_feeBasisPoints` basis points.
      * The fees are accrued when:
      * - oracles report staking results (beacon chain balance increase)
      * - validators gain execution layer rewards (priority fees and MEV)
      * @param _feeBasisPoints Fee rate, in basis points
      */
    function setFee(uint16 _feeBasisPoints) external;

    /**
      * @notice Set fee distribution
      * @param _treasuryFeeBasisPoints basis points go to the treasury,
      * @param _insuranceFeeBasisPoints basis points go to the insurance fund,
      * @param _operatorsFeeBasisPoints basis points go to node operators.
      * @dev The sum has to be 10 000.
      */
    function setFeeDistribution(
        uint16 _treasuryFeeBasisPoints,
        uint16 _insuranceFeeBasisPoints,
        uint16 _operatorsFeeBasisPoints
    ) external;

    /**
      * @notice Returns staking rewards fee rate
      */
    function getFee() external view returns (uint16 feeBasisPoints);

    /**
      * @notice Returns fee distribution proportion
      */
    function getFeeDistribution() external view returns (
        uint16 treasuryFeeBasisPoints,
        uint16 insuranceFeeBasisPoints,
        uint16 operatorsFeeBasisPoints
    );

    event FeeSet(uint16 feeBasisPoints);

    event FeeDistributionSet(uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints, uint16 operatorsFeeBasisPoints);

    /**
      * @notice A payable function supposed to be called only by LidoExecLayerRewardsVault contract
      * @dev We need a separate function because funds received by default payable function
      * are considered as funds submitted by a user for staking
      */
    function receiveExecLayerRewards() external payable;

    // The amount of ETH withdrawn from LidoExecLayerRewardsVault contract to Lido contract
    event ExecLayerRewardsReceived(uint256 amount);

    /**
      * @dev Sets limit to amount of ETH to withdraw from execution layer rewards vault per LidoOracle report
      * @param _limitPoints limit in basis points to amount of ETH to withdraw per LidoOracle report
      */
    function setExecLayerRewardsWithdrawalLimit(uint16 _limitPoints) external;

    // Percent in basis points of total pooled ether allowed to withdraw from LidoExecLayerRewardsVault per LidoOracle report
    event ExecLayerRewardsWithdrawalLimitSet(uint256 limitPoints);

    /**
      * @notice Set credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched to `_withdrawalCredentials`
      * @dev Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
      * @param _withdrawalCredentials hash of withdrawal multisignature key as accepted by
      *        the deposit_contract.deposit function
      */
    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external;

    /**
      * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      */
    function getWithdrawalCredentials() external view returns (bytes);

    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials);

    /**
    * @dev Sets the address of LidoExecLayerRewardsVault contract
    * @param _execLayerRewardsVault Execution layer rewards vault contract address
    */
    function setExecLayerRewardsVault(address _execLayerRewardsVault) external;

    // The `execLayerRewardsVault` was set as the execution layer rewards vault for Lido
    event LidoExecLayerRewardsVaultSet(address execLayerRewardsVault);

    /**
      * @notice Ether on the ETH 2.0 side reported by the oracle
      * @param _epoch Epoch id
      * @param _eth2balance Balance in wei on the ETH 2.0 side
      */
    function handleOracleReport(uint256 _epoch, uint256 _eth2balance) external;


    // User functions

    /**
      * @notice Adds eth to the pool
      * @return StETH Amount of StETH generated
      */
    function submit(address _referral) external payable returns (uint256 StETH);

    // Records a deposit made by a user
    event Submitted(address indexed sender, uint256 amount, address referral);

    // The `amount` of ether was sent to the deposit_contract.deposit function
    event Unbuffered(uint256 amount);

    /**
      * @notice Issues withdrawal request. Large withdrawals will be processed only after the phase 2 launch.
      * @param _amount Amount of StETH to burn
      * @param _pubkeyHash Receiving address
      */
    function withdraw(uint256 _amount, bytes32 _pubkeyHash) external;

    // Requested withdrawal of `etherAmount` to `pubkeyHash` on the ETH 2.0 side, `tokenAmount` burned by `sender`,
    // `sentFromBuffer` was sent on the current Ethereum side.
    event Withdrawal(address indexed sender, uint256 tokenAmount, uint256 sentFromBuffer,
                     bytes32 indexed pubkeyHash, uint256 etherAmount);


    // Info functions

    /**
      * @notice Gets the amount of Ether controlled by the system
      */
    function getTotalPooledEther() external view returns (uint256);

    /**
      * @notice Gets the amount of Ether temporary buffered on this contract balance
      */
    function getBufferedEther() external view returns (uint256);

    /**
      * @notice Returns the key values related to Beacon-side
      * @return depositedValidators - number of deposited validators
      * @return beaconValidators - number of Lido's validators visible in the Beacon state, reported by oracles
      * @return beaconBalance - total amount of Beacon-side Ether (sum of all the balances of Lido validators)
      */
    function getBeaconStat() external view returns (uint256 depositedValidators, uint256 beaconValidators, uint256 beaconBalance);

    // Requested ERC721 recovery from the `Lido` to the designated `recoveryVault` vault.
    event RecoverERC721ToVault(address indexed vault, address indexed token, uint256 tokenId);
}
