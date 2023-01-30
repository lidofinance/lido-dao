// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;


import { HashConsensus } from "../../oracle/HashConsensus.sol";


contract HashConsensusTimeTravellable is HashConsensus {
    // must be at least GENESIS_TIME to avoid underflow
    uint256 internal _time = 100500;

    constructor(
        uint256 slotsPerEpoch,
        uint256 secondsPerSlot,
        uint256 genesisTime,
        uint256 epochsPerFrame,
        uint256 startEpoch,
        address admin,
        address reportProcessor
    ) HashConsensus(
        slotsPerEpoch,
        secondsPerSlot,
        genesisTime,
        epochsPerFrame,
        startEpoch,
        admin,
        reportProcessor
    ) {}

    function getTime() external view returns (uint256) {
        return _time;
    }

    function setTime(uint256 newTime) external {
        _time = newTime;
    }

    function advanceTimeBy(uint256 timeAdvance) external {
        _time += timeAdvance;
    }

    function _getTime() internal override view returns (uint256) {
        return _time;
    }
}
