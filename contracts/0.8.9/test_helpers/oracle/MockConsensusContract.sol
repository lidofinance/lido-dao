// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { SafeCast } from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";

import { IConsensusContract } from "../../oracle/BaseOracle.sol";

contract MockConsensusContract is IConsensusContract {
    using SafeCast for uint256;

    uint64 internal immutable SLOTS_PER_EPOCH;
    uint64 internal immutable SECONDS_PER_SLOT;
    uint64 internal immutable GENESIS_TIME;

    mapping(address => uint256) internal _memberIndices1b;

    struct ConsensusFrame {
        uint256 index;
        uint256 refSlot;
        uint256 reportProcessingDeadlineSlot;
    }
    struct FrameConfig {
        uint64 initialEpoch;
        uint64 epochsPerFrame;
        uint64 fastLaneLengthSlots;
    }
    FrameConfig internal _frameConfig;
    ConsensusFrame internal _consensusFrame;

     constructor(
        uint256 slotsPerEpoch,
        uint256 secondsPerSlot,
        uint256 genesisTime,
        uint256 epochsPerFrame,
        uint256 initialEpoch,
        uint256 fastLaneLengthSlots
    ) {
        SLOTS_PER_EPOCH = slotsPerEpoch.toUint64();
        SECONDS_PER_SLOT = secondsPerSlot.toUint64();
        GENESIS_TIME = genesisTime.toUint64();

        _setFrameConfig(initialEpoch, epochsPerFrame, fastLaneLengthSlots);
    }

    function getIsMember(address addr) external view returns (bool) {
        return _memberIndices1b[addr] != 0;
    }

    function getCurrentFrame() external view returns (
        uint256 refSlot,
        uint256 reportProcessingDeadlineSlot
    ) {
        return (_consensusFrame.refSlot, _consensusFrame.reportProcessingDeadlineSlot);
    }

    function getChainConfig() external view returns (
        uint256 slotsPerEpoch,
        uint256 secondsPerSlot,
        uint256 genesisTime
    ) {
        return (SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME);
    }

    function getFrameConfig() external view returns (uint256 initialEpoch, uint256 epochsPerFrame) {
        return (_frameConfig.initialEpoch, _frameConfig.epochsPerFrame);
    }

    function _setFrameConfig(
        uint256 initialEpoch,
        uint256 epochsPerFrame,
        uint256 fastLaneLengthSlots
    ) internal {
        _frameConfig = FrameConfig(
            initialEpoch.toUint64(),
            epochsPerFrame.toUint64(),
            fastLaneLengthSlots.toUint64()
        );
    }
}
