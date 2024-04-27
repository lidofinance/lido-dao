// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
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

  function testFuzz_initLimiterStateTooLowLimit(TokenRebaseLimiterData calldata _fuzzData) external {
    vm.expectRevert(PositiveTokenRebaseLimiter.TooLowTokenRebaseLimit.selector);
    rebaseLimiter.initLimiterState(0, _fuzzData.preTotalPooledEther, _fuzzData.preTotalShares);
  }

  function testFuzz_initLimiterTooHighLimit(TokenRebaseLimiterData calldata _fuzzData) external {
    uint256 rebaseLimit = bound(
      _fuzzData.positiveRebaseLimit,
      PositiveTokenRebaseLimiter.UNLIMITED_REBASE + 1,
      type(uint256).max
    );

    vm.expectRevert(PositiveTokenRebaseLimiter.TooHighTokenRebaseLimit.selector);
    rebaseLimiter.initLimiterState(rebaseLimit, _fuzzData.preTotalPooledEther, _fuzzData.preTotalShares);
  }

  function testFuzz_initLimiterState(TokenRebaseLimiterData calldata _fuzzData) external {
    uint256 rebaseLimit = bound(_fuzzData.positiveRebaseLimit, 1, PositiveTokenRebaseLimiter.UNLIMITED_REBASE);
    uint256 preTotalPooledEther = bound(_fuzzData.preTotalPooledEther, 0, 200_000_000 * 10 ** 18);
    uint256 preTotalShares = bound(_fuzzData.preTotalShares, 0, 200_000_000 * 10 ** 18);

    rebaseLimiter.initLimiterState(rebaseLimit, preTotalPooledEther, preTotalShares);

    TokenRebaseLimiterData memory data = rebaseLimiter.getData__harness();

    assertEq(data.preTotalPooledEther, preTotalPooledEther);
    assertEq(data.preTotalShares, preTotalShares);
    assertEq(data.currentTotalPooledEther, preTotalPooledEther);

    if (preTotalPooledEther == 0) {
      assertEq(data.positiveRebaseLimit, PositiveTokenRebaseLimiter.UNLIMITED_REBASE);
    }

    if (data.positiveRebaseLimit != PositiveTokenRebaseLimiter.UNLIMITED_REBASE) {
      assertTrue(preTotalPooledEther != 0);
      assertEq(data.positiveRebaseLimit, rebaseLimit);
      assertEq(
        data.maxTotalPooledEther,
        preTotalPooledEther + (preTotalPooledEther * rebaseLimit) / PositiveTokenRebaseLimiter.LIMITER_PRECISION_BASE
      );
    } else {
      assertEq(data.positiveRebaseLimit, PositiveTokenRebaseLimiter.UNLIMITED_REBASE);
      assertEq(data.maxTotalPooledEther, type(uint256).max);
    }
  }

  function testFuzz_isLimitReached(TokenRebaseLimiterData calldata _fuzzData) external {
    rebaseLimiter.setData__harness(_fuzzData);

    bool isLimitReached = rebaseLimiter.isLimitReached();
    if (_fuzzData.currentTotalPooledEther >= _fuzzData.maxTotalPooledEther) {
      assertTrue(isLimitReached);
    } else {
      assertFalse(isLimitReached);
    }
  }

  function testFuzz_decreaseEtherUnlimited(TokenRebaseLimiterData memory _fuzzData, uint256 _etherAmount) external {
    _fuzzData.positiveRebaseLimit = PositiveTokenRebaseLimiter.UNLIMITED_REBASE;
    rebaseLimiter.setData__harness(_fuzzData);

    rebaseLimiter.decreaseEther(_etherAmount);

    TokenRebaseLimiterData memory data = rebaseLimiter.getData__harness();

    // hasn't been changed
    assertEq(data.currentTotalPooledEther, _fuzzData.currentTotalPooledEther);
    assertEq(data.positiveRebaseLimit, PositiveTokenRebaseLimiter.UNLIMITED_REBASE);
  }

  function testFuzz_decreaseEther(TokenRebaseLimiterData memory _fuzzData, uint256 _etherAmount) external {
    _fuzzData.positiveRebaseLimit = bound(
      _fuzzData.positiveRebaseLimit,
      0,
      PositiveTokenRebaseLimiter.UNLIMITED_REBASE - 1
    );
    _fuzzData.currentTotalPooledEther = bound(_fuzzData.currentTotalPooledEther, 0, 200_000_000 * 10 ** 18);
    rebaseLimiter.setData__harness(_fuzzData);

    _etherAmount = bound(_etherAmount, 0, 200_000_000 * 10 ** 18);

    if (_etherAmount > _fuzzData.currentTotalPooledEther) {
      vm.expectRevert(PositiveTokenRebaseLimiter.NegativeTotalPooledEther.selector);
      rebaseLimiter.decreaseEther(_etherAmount);
    } else {
      rebaseLimiter.decreaseEther(_etherAmount);
      TokenRebaseLimiterData memory data = rebaseLimiter.getData__harness();

      assertEq(data.currentTotalPooledEther, _fuzzData.currentTotalPooledEther - _etherAmount);
      assertEq(data.positiveRebaseLimit, _fuzzData.positiveRebaseLimit);
    }
  }

  function testFuzz_increaseEtherUnlimited(TokenRebaseLimiterData memory _fuzzData, uint256 _etherAmount) external {
    _fuzzData.positiveRebaseLimit = PositiveTokenRebaseLimiter.UNLIMITED_REBASE;
    rebaseLimiter.setData__harness(_fuzzData);

    rebaseLimiter.increaseEther(_etherAmount);

    TokenRebaseLimiterData memory data = rebaseLimiter.getData__harness();

    assertEq(data.positiveRebaseLimit, PositiveTokenRebaseLimiter.UNLIMITED_REBASE);
    // values haven't been changed
    assertEq(data.currentTotalPooledEther, _fuzzData.currentTotalPooledEther);
    assertEq(data.maxTotalPooledEther, _fuzzData.maxTotalPooledEther);
  }

  function testFuzz_increaseEther(TokenRebaseLimiterData memory _fuzzData, uint256 _etherAmount) external {
    _fuzzData.positiveRebaseLimit = bound(
      _fuzzData.positiveRebaseLimit,
      0,
      PositiveTokenRebaseLimiter.UNLIMITED_REBASE - 1
    );
    _fuzzData.maxTotalPooledEther = bound(_fuzzData.maxTotalPooledEther, 0, 200_000_000 * 10 ** 18);
    _fuzzData.currentTotalPooledEther = bound(_fuzzData.currentTotalPooledEther, 0, _fuzzData.maxTotalPooledEther);

    rebaseLimiter.setData__harness(_fuzzData);

    _etherAmount = bound(_etherAmount, 0, 200_000_000 * 10 ** 18);

    uint256 consumed = rebaseLimiter.increaseEther(_etherAmount);
    TokenRebaseLimiterData memory data = rebaseLimiter.getData__harness();

    assertLe(data.currentTotalPooledEther, data.maxTotalPooledEther);

    if ((_fuzzData.currentTotalPooledEther + _etherAmount) <= _fuzzData.maxTotalPooledEther) {
      assertEq(consumed, _etherAmount);
      if ((_fuzzData.currentTotalPooledEther + _etherAmount) == _fuzzData.maxTotalPooledEther) {
        assertEq(data.currentTotalPooledEther, data.maxTotalPooledEther);
      }
    } else {
      uint256 overlimit = (_fuzzData.currentTotalPooledEther + _etherAmount) - _fuzzData.maxTotalPooledEther;
      assertEq(consumed, _etherAmount - overlimit);
    }
    assertEq(data.maxTotalPooledEther, _fuzzData.maxTotalPooledEther);
    assertEq(data.positiveRebaseLimit, _fuzzData.positiveRebaseLimit);
  }

  function testFuzz_getSharesToBurnLimitUnlimited(TokenRebaseLimiterData memory _fuzzData) external {
    _fuzzData.positiveRebaseLimit = PositiveTokenRebaseLimiter.UNLIMITED_REBASE;
    rebaseLimiter.setData__harness(_fuzzData);

    uint256 sharesToBurnLimit = rebaseLimiter.getSharesToBurnLimit();

    assertEq(sharesToBurnLimit, _fuzzData.preTotalShares);
  }

  function testFuzz_getSharesToBurnLimitZeroTVL(TokenRebaseLimiterData memory _fuzzData) external {
    _fuzzData.positiveRebaseLimit = bound(
      _fuzzData.positiveRebaseLimit,
      0,
      PositiveTokenRebaseLimiter.UNLIMITED_REBASE - 1
    );
    _fuzzData.preTotalPooledEther = 0;
    rebaseLimiter.setData__harness(_fuzzData);

    if (!rebaseLimiter.isLimitReached()) {
      vm.expectRevert();
      rebaseLimiter.getSharesToBurnLimit();
    }
  }

  function testFuzz_getSharesToBurnLimit(TokenRebaseLimiterData memory _fuzzData) external {
    _fuzzData.preTotalPooledEther = bound(_fuzzData.preTotalPooledEther, 1, 200_000_000 * 10 ** 18);
    _fuzzData.preTotalShares = bound(_fuzzData.preTotalShares, 0, 200_000_000 * 10 ** 18);
    _fuzzData.currentTotalPooledEther = bound(_fuzzData.currentTotalPooledEther, 0, _fuzzData.maxTotalPooledEther);
    _fuzzData.positiveRebaseLimit = bound(
      _fuzzData.positiveRebaseLimit,
      0,
      PositiveTokenRebaseLimiter.UNLIMITED_REBASE - 1
    );
    _fuzzData.maxTotalPooledEther = bound(_fuzzData.currentTotalPooledEther, 0, 200_000_000 * 10 ** 18);

    rebaseLimiter.setData__harness(_fuzzData);

    //TODO: requires proper initialization
    //uint256 sharesToBurnLimit = rebaseLimiter.getSharesToBurnLimit();

    //assertEq(sharesToBurnLimit, _data.preTotalShares);
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
    TokenRebaseLimiterData memory data = trlData;
    data.decreaseEther(_etherAmount);
    trlData = data;

    emit EtherDecreased(_etherAmount);
  }

  function increaseEther(uint256 _etherAmount) external returns (uint256 consumed) {
    TokenRebaseLimiterData memory data = trlData;
    consumed = data.increaseEther(_etherAmount);
    trlData = data;

    emit EtherIncreased(_etherAmount);
  }

  function getSharesToBurnLimit() external view returns (uint256 maxSharesToBurn) {
    return trlData.getSharesToBurnLimit();
  }
}
