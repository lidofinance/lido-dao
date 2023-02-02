// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { ILegacyOracle } from "../../oracle/AccountingOracle.sol";


contract MockLegacyOracle is ILegacyOracle {
    uint64 internal _epochsPerFrame;
    uint64 internal _slotsPerEpoch;
    uint64 internal _secondsPerSlot;
    uint64 internal _genesisTime;
    uint256 internal _lastCompletedEpochId;

    constructor(
        uint64 epochsPerFrame,
        uint64 slotsPerEpoch,
        uint64 secondsPerSlot,
        uint64 genesisTime,
        uint256 lastCompletedEpochId
    ) {
        _epochsPerFrame = epochsPerFrame;
        _slotsPerEpoch = slotsPerEpoch;
        _secondsPerSlot = secondsPerSlot;
        _genesisTime = genesisTime;
        _lastCompletedEpochId = lastCompletedEpochId;
    }

    function getBeaconSpec() external view returns (
        uint64 epochsPerFrame,
        uint64 slotsPerEpoch,
        uint64 secondsPerSlot,
        uint64 genesisTime
    ) {
        return (
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );
    }

    function getLastCompletedEpochId() external view returns (uint256) {
        return _lastCompletedEpochId;
    }

    function setLastCompletedEpochId(uint256 lastCompletedEpochId) external {
        _lastCompletedEpochId = lastCompletedEpochId;
    }
}
