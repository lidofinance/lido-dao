// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;


/**
  * @dev Only for testing purposes! Lido version with some functions exposed.
  */
contract LidoMockForOracleNew {
    uint256 private totalPooledEther;
    address private nodeOperatorsRegistry;

    constructor (address _nodeOperatorsRegistry) {
        nodeOperatorsRegistry = _nodeOperatorsRegistry;
    }

    function totalSupply() external view returns (uint256) {
        return totalPooledEther;
    }

    /// FIXME: use the correct signature

    function handleOracleReport(
        uint256 /* reportTimestamp */,
        uint256 /* secondsElapsedSinceLastReport */,
        uint256 /* numValidators */,
        uint256 clBalance,
        uint256 /* withdrawalVaultBalance */,
        uint256 /* elRewardsVaultBalance */,
        uint256 /* lastWithdrawalRequestIdToFinalize */,
        uint256 /* finalizationShareRate */
    ) external returns (uint256, uint256, uint256, uint256) {
        totalPooledEther = clBalance;
    }

    function getTotalShares() public pure returns (uint256) {
        return 42;
    }

    function pretendTotalPooledEtherGweiForTest(uint256 _val) public {
        totalPooledEther = _val * 1e9; // gwei to wei
    }

    function getOperators() external view returns (address) {
        return nodeOperatorsRegistry;
    }
}
