// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {Test} from "forge-std/Test.sol";

import {PositiveTokenRebaseLimiter, TokenRebaseLimiterData} from "contracts/0.8.9/lib/PositiveTokenRebaseLimiter.sol";

contract PositiveTokenRebaseLimiterTest is Test {
  PositiveTokenRebaseLimiter__Harness public rebaseLimiter;

  function setUp() public {
    rebaseLimiter = new PositiveTokenRebaseLimiter__Harness();
  }

  function testFuzz_initLimiterStateTooLowLimit(uint256 _preTotalPooledEther, uint256 _preTotalShares) external {
    vm.expectRevert();
    rebaseLimiter.initLimiterState(0, _preTotalPooledEther, _preTotalShares);
  }

  function testFuzz_initLimiterTooHighLimit(
    uint256 _rebaseLimit,
    uint256 _preTotalPooledEther,
    uint256 _preTotalShares
  ) external {
    _rebaseLimit = bound(_rebaseLimit, PositiveTokenRebaseLimiter.UNLIMITED_REBASE + 1, type(uint256).max);

    vm.expectRevert();
    rebaseLimiter.initLimiterState(_rebaseLimit, _preTotalPooledEther, _preTotalShares);
  }

  function testFuzz_initLimiterState(
    uint256 _rebaseLimit,
    uint256 _preTotalPooledEther,
    uint256 _preTotalShares
  ) external {
    _rebaseLimit = bound(_rebaseLimit, 1, PositiveTokenRebaseLimiter.UNLIMITED_REBASE);
    _preTotalPooledEther = bound(_preTotalPooledEther, 0, 200_000_000 * 10 ** 18);
    _preTotalShares = bound(_preTotalShares, 0, 200_000_000 * 10 ** 18);

    rebaseLimiter.initLimiterState(_rebaseLimit, _preTotalPooledEther, _preTotalShares);

    TokenRebaseLimiterData memory data = rebaseLimiter.getData__harness();

    assertEq(data.preTotalPooledEther, _preTotalPooledEther);
    assertEq(data.preTotalShares, _preTotalShares);

    if (_preTotalPooledEther != 0) {
      assertEq(data.positiveRebaseLimit, _rebaseLimit);
    } else {
      assertEq(data.positiveRebaseLimit, PositiveTokenRebaseLimiter.UNLIMITED_REBASE);
      assertEq(data.maxTotalPooledEther, type(uint256).max);
    }
  }
}

contract PositiveTokenRebaseLimiter__Harness {
  using PositiveTokenRebaseLimiter for TokenRebaseLimiterData;

  TokenRebaseLimiterData trlData;

  event DataSet(
    uint256 preTotalPooledEther,
    uint256 preTotalShares,
    uint256 currentTotalPooledEther,
    uint256 positiveRebaseLimit,
    uint256 maxTotalPooledEther
  );
  event LimiterStateInitialized(uint256 rebaseLimit, uint256 preTotalPooledEther, uint256 preTotalShares);
  event EtherDecreased(uint256 etherAmount);
  event EtherIncreased(uint256 etherAmount);

  function getData__harness() external view returns (TokenRebaseLimiterData memory) {
    return trlData;
  }

  function setData__harness(TokenRebaseLimiterData calldata _data) external {
    trlData = _data;

    emit DataSet(
      _data.preTotalPooledEther,
      _data.preTotalShares,
      _data.currentTotalPooledEther,
      _data.positiveRebaseLimit,
      _data.maxTotalPooledEther
    );
  }

  function initLimiterState(uint256 _rebaseLimit, uint256 _preTotalPooledEther, uint256 _preTotalShares) external {
    trlData = PositiveTokenRebaseLimiter.initLimiterState(_rebaseLimit, _preTotalPooledEther, _preTotalShares);

    emit LimiterStateInitialized(_rebaseLimit, _preTotalPooledEther, _preTotalShares);
  }

  function isLimitReached() external view returns (bool) {
    return trlData.isLimitReached();
  }

  function decreaseEther(uint256 _etherAmount) external {
    trlData.decreaseEther(_etherAmount);

    emit EtherDecreased(_etherAmount);
  }

  function increaseEther(uint256 _etherAmount) external {
    trlData.increaseEther(_etherAmount);

    emit EtherIncreased(_etherAmount);
  }

  function getSharesToBurnLimit() external view returns (uint256 maxSharesToBurn) {
    return trlData.getSharesToBurnLimit();
  }
}
