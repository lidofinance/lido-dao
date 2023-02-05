// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.4.24;


interface ILegacyOracle {
    function getBeaconSpec() external view returns (
        uint64 epochsPerFrame,
        uint64 slotsPerEpoch,
        uint64 secondsPerSlot,
        uint64 genesisTime
    );

    function getLastCompletedEpochId() external view returns (uint256);
}

import "../oracle/LidoOracle.sol";

contract MockLegacyOracle is ILegacyOracle, LidoOracle {
    uint64 internal _epochsPerFrame;
    uint64 internal _slotsPerEpoch;
    uint64 internal _secondsPerSlot;
    uint64 internal _genesisTime;
    uint256 internal _lastCompletedEpochId;


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


    function setParams(
        uint64 epochsPerFrame,
        uint64 slotsPerEpoch,
        uint64 secondsPerSlot,
        uint64 genesisTime,
        uint256 lastCompletedEpochId
    ) external {
        _epochsPerFrame = epochsPerFrame;
        _slotsPerEpoch = slotsPerEpoch;
        _secondsPerSlot = secondsPerSlot;
        _genesisTime = genesisTime;
        _lastCompletedEpochId = lastCompletedEpochId;

    }
    function getLastCompletedEpochId() external view returns (uint256) {
        return _lastCompletedEpochId;
    }

    function setLastCompletedEpochId(uint256 lastCompletedEpochId) external {
        _lastCompletedEpochId = lastCompletedEpochId;
    }
}
