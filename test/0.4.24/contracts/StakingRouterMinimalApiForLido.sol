// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.4.24;


contract StakingRouterMinimalApiForLido {

  function getWithdrawalCredentials() external view returns(bytes32) {
    return 0x010000000000000000000000b9d7934878b5fb9610b3fe8a5e441e8fad7e293f; // Lido Withdrawal Creds
  }

  function getTotalFeeE4Precision() external view returns(uint16) {
    return 1000; // 10%
  }

  function TOTAL_BASIS_POINTS() external view returns(uint256) {
    return 10000; // 100%
  }

  function getStakingFeeAggregateDistributionE4Precision() external view returns(
    uint16 treasuryFee,
    uint16 modulesFee
  ) {
    treasuryFee = 500;
    modulesFee = 500;
  }
}
