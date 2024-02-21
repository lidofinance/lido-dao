// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "contracts/0.8.9/utils/PausableUntil.sol";


contract PausableUntilMockWithExposedApi is PausableUntil {
  function testWhenPaused() external view whenPaused {}

  function testWhenResumed() external view whenResumed {}

  function pauseFor(uint256 _duration) external {
    _pauseFor(_duration);
  }

  function pauseUntil(uint256 _pauseUntilInclusive) external {
    _pauseUntil(_pauseUntilInclusive);
  }

  function resume() external {
    _resume();
  }

  function setPauseState(uint256 _resumeSince) external {
    _setPausedState(_resumeSince);
  }
}
