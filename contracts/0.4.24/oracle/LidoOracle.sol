// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";


interface INewOracle {
    function getConsensusContract() external view returns (address);
}


interface IHashConsensus {
    function getQuorum() external view returns (uint256);

    function getChainConfig() external view returns (
        uint256 slotsPerEpoch,
        uint256 secondsPerSlot,
        uint256 genesisTime
    );

    function getFrameConfig() external view returns (
        uint256 initialEpoch,
        uint256 epochsPerFrame
    );

    function getCurrentFrame() external view returns (
        uint256 refSlot,
        uint256 reportProcessingDeadlineSlot
    );
}


/**
 * @title DEPRECATED legacy oracle contract stub kept for compatibility purposes only.
 * Should not be used in new code.
 *
 * Previously, the oracle contract was located at this address. Currently, the oracle lives
 * at a different address, and this contract is kept for the compatibility, supporting a
 * limited subset of view functions and events.
 *
 * See docs.lido.fi for more info.
 */
contract LidoOracle is AragonApp {

    struct ChainSpec {
        uint64 epochsPerFrame;
        uint64 slotsPerEpoch;
        uint64 secondsPerSlot;
        uint64 genesisTime;
    }

    /// @notice DEPRECATED, kept for compatibility purposes only. The new Rebase event emitted
    /// from the main Lido contract should be used instead.
    ///
    /// This event is still emitted after oracle committee reaches consensus on a report, but
    /// only for compatibility purposes. The values in this event are not enough to calculate
    /// APR or TVL anymore due to withdrawals, execution layer rewards, and consensus layer
    /// rewards skimming.
    event Completed(
        uint256 epochId,
        uint128 beaconBalance,
        uint128 beaconValidators
    );

    /// @notice DEPRECATED, kept for compatibility purposes only. The new Rebase event emitted
    /// from the main Lido contract should be used instead.
    ///
    /// This event is still emitted after each rebase but only for compatibility purposes.
    /// The values in this event are not enough to correctly calculate the rebase APR since
    /// a rebase can result from shares burning without changing total ETH held by the
    /// protocol.
    event PostTotalShares(
        uint256 postTotalPooledEther,
        uint256 preTotalPooledEther,
        uint256 timeElapsed,
        uint256 totalShares
    );

    event ContractVersionSet(uint256 version);

    /// Address of the Lido contract
    bytes32 internal constant LIDO_POSITION =
        0xf6978a4f7e200f6d3a24d82d44c48bddabce399a3b8ec42a480ea8a2d5fe6ec5; // keccak256("lido.LidoOracle.lido")

    /// Address of the new accounting oracle contract
    bytes32 internal constant NEW_ORACLE_POSITION =
        0x6071464af3a725b2c260db7b8df5f609fc12a4b15ab905324f56370bd90b5ed2; // keccak256("lido.LidoOracle.newOracle");

    /// Storage for the Ethereum chain specification
    bytes32 internal constant BEACON_SPEC_POSITION =
        0x805e82d53a51be3dfde7cfed901f1f96f5dad18e874708b082adb8841e8ca909; // keccak256("lido.LidoOracle.beaconSpec")

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION =
        0x75be19a3f314d89bd1f84d30a6c84e2f1cd7afc7b6ca21876564c265113bb7e4; // keccak256("lido.LidoOracle.contractVersion")

    /// Historic data about 2 last completed reports and their times
    bytes32 internal constant POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0xaa8433b13d2b111d4f84f6f374bc7acbe20794944308876aa250fa9a73dc7f53; // keccak256("lido.LidoOracle.postCompletedTotalPooledEther")
    bytes32 internal constant PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0x1043177539af09a67d747435df3ff1155a64cd93a347daaac9132a591442d43e; // keccak256("lido.LidoOracle.preCompletedTotalPooledEther")
    bytes32 internal constant LAST_COMPLETED_EPOCH_ID_POSITION =
        0xdad15c0beecd15610092d84427258e369d2582df22869138b4c5265f049f574c; // keccak256("lido.LidoOracle.lastCompletedEpochId")
    bytes32 internal constant TIME_ELAPSED_POSITION =
        0x8fe323f4ecd3bf0497252a90142003855cc5125cee76a5b5ba5d508c7ec28c3a; // keccak256("lido.LidoOracle.timeElapsed")

    /**
     * @notice Returns the Lido contract address.
     */
    function getLido() public view returns (address) {
        return LIDO_POSITION.getStorageAddress();
    }

    /**
     * @notice Returns the new oracle contract address.
     */
    function getNewOracle() public view returns (address) {
        return NEW_ORACLE_POSITION.getStorageAddress();
    }

    /**
     * @notice Returns the initialized version of this contract starting from 0.
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    ///
    /// Compatibility interface (DEPRECATED)
    ///

    /**
     * @notice DEPRECATED, kept for compatibility purposes only.
     *
     * Returns the number of exactly the same reports needed to finalize the reporting frame.
     */
    function getQuorum() external view returns (uint256) {
        return _getNewConsensusContract().getQuorum();
    }

    /**
     * @notice DEPRECATED, kept for compatibility purposes only.
     *
     * Returns the Ethereum chain specification.
     */
    function getBeaconSpec()
        external
        view
        returns (
            uint64 epochsPerFrame,
            uint64 slotsPerEpoch,
            uint64 secondsPerSlot,
            uint64 genesisTime
        )
    {
        (, uint256 epochsPerFrame_) = _getNewConsensusContract().getFrameConfig();
        epochsPerFrame = uint64(epochsPerFrame_);

        ChainSpec memory spec = _getChainSpec();
        slotsPerEpoch = spec.slotsPerEpoch;
        secondsPerSlot = spec.secondsPerSlot;
        genesisTime = spec.genesisTime;
    }

    /**
     * @notice DEPRECATED, kept for compatibility purposes only.
     *
     * Returns the epoch calculated from current timestamp
     */
    function getCurrentEpochId() external view returns (uint256 epochId) {
        (epochId, ,) = _getCurrentFrameFromNewOracle();
    }

    /**
     * @notice DEPRECATED, kept for compatibility purposes only.
     *
     * Returns the first epoch of the current reporting frame as well as its start and end
     * times in seconds.
     */
    function getCurrentFrame()
        external
        view
        returns (
            uint256 frameEpochId,
            uint256 frameStartTime,
            uint256 frameEndTime
        )
    {
        return _getCurrentFrameFromNewOracle();
    }

    /**
     * @notice DEPRECATED, kept for compatibility purposes only.
     *
     * Returns the starting epoch of the last frame in which an oracle report was received
     * and applied.
     */
    function getLastCompletedEpochId() external view returns (uint256) {
        return LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256();
    }

    /**
     * @notice DEPRECATED, kept for compatibility purposes only.
     *
     * The change of the protocol TVL that the last rebase resulted in. Notice that, during
     * a rebase, stETH shares can be minted to distribute protocol fees and burnt to apply
     * cover for losses incurred by slashed or unresponsive validators. A rebase might be
     * triggered without changing the protocol TVL. Thus, it's impossible to correctly
     * calculate APR from the numbers returned by this function.
     *
     * See docs.lido.fi for the correct way of onchain and offchain APR calculation.
     */
    function getLastCompletedReportDelta()
        external
        view
        returns (
            uint256 postTotalPooledEther,
            uint256 preTotalPooledEther,
            uint256 timeElapsed
        )
    {
        postTotalPooledEther = POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.getStorageUint256();
        preTotalPooledEther = PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.getStorageUint256();
        timeElapsed = TIME_ELAPSED_POSITION.getStorageUint256();
    }

    ///
    /// Internal interface & implementation.
    ///

    /**
     * @notice Called by Lido on each rebase.
     */
    function handlePostTokenRebase(
        uint256 /* reportTimestamp */,
        uint256 timeElapsed,
        uint256 /* preTotalShares */,
        uint256 preTotalEther,
        uint256 postTotalShares,
        uint256 postTotalEther,
        uint256 /* totalSharesMintedAsFees */
    )
        external
    {
        require(msg.sender == getLido(), "SENDER_NOT_ALLOWED");

        PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(preTotalEther);
        POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(postTotalEther);
        TIME_ELAPSED_POSITION.setStorageUint256(timeElapsed);

        emit PostTotalShares(postTotalEther, preTotalEther, timeElapsed, postTotalShares);
    }

    /**
     * @notice Called by the new accounting oracle on each report.
     */
    function handleConsensusLayerReport(uint256 _refSlot, uint256 _clBalance, uint256 _clValidators)
        external
    {
        require(msg.sender == getNewOracle(), "SENDER_NOT_ALLOWED");

        // new oracle's ref. slot is the last slot of the epoch preceding the one the frame starts at
        uint256 epochId = (_refSlot + 1) / _getChainSpec().slotsPerEpoch;
        LAST_COMPLETED_EPOCH_ID_POSITION.setStorageUint256(epochId);

        emit Completed(epochId, uint128(_clBalance), uint128(_clValidators));
    }

    /**
     * @notice Initializes the contract (the compat-only deprecated version 4) from scratch.
     * @param _lido Address of the Lido contract.
     * @param _newOracle Address of the new accounting oracle contract.
     */
    function initialize(address _lido, address _newOracle) external onlyInit {
        // Initializations for v0 --> v3
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "BASE_VERSION_MUST_BE_ZERO");

        require(_lido != address(0), "ZERO_LIDO_ADDRESS");
        LIDO_POSITION.setStorageAddress(_lido);

        // Initializations for v3 --> v4
        _initialize_v4(_newOracle);
        _setChainSpec(_getNewOracleChainSpec(_newOracle));

        // Needed to finish the Aragon part of initialization (otherwise auth() modifiers will fail)
        initialized();
    }

    /**
     * @notice A function to finalize upgrade v3 -> v4 (the compat-only deprecated impl).
     * Can be called only once.
     */
    function finalizeUpgrade_v4(address _newOracle) external {
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 3, "WRONG_BASE_VERSION");

        _initialize_v4(_newOracle);

        ChainSpec memory spec = _getChainSpec();
        ChainSpec memory newSpec = _getNewOracleChainSpec(_newOracle);

        require(
            spec.slotsPerEpoch == newSpec.slotsPerEpoch &&
            spec.secondsPerSlot == newSpec.secondsPerSlot &&
            spec.genesisTime == newSpec.genesisTime,
            "UNEXPECTED_CHAIN_SPEC"
        );
    }

    function _initialize_v4(address _newOracle) internal {
        require(_newOracle != address(0), "ZERO_NEW_ORACLE_ADDRESS");
        NEW_ORACLE_POSITION.setStorageAddress(_newOracle);
        CONTRACT_VERSION_POSITION.setStorageUint256(4);
        emit ContractVersionSet(4);
    }

    function _getChainSpec()
        internal
        view
        returns (ChainSpec memory chainSpec)
    {
        uint256 data = BEACON_SPEC_POSITION.getStorageUint256();
        chainSpec.epochsPerFrame = uint64(data >> 192);
        chainSpec.slotsPerEpoch = uint64(data >> 128);
        chainSpec.secondsPerSlot = uint64(data >> 64);
        chainSpec.genesisTime = uint64(data);
        return chainSpec;
    }

    function _setChainSpec(ChainSpec memory _chainSpec) internal {
        require(_chainSpec.slotsPerEpoch > 0, "BAD_SLOTS_PER_EPOCH");
        require(_chainSpec.secondsPerSlot > 0, "BAD_SECONDS_PER_SLOT");
        require(_chainSpec.genesisTime > 0, "BAD_GENESIS_TIME");

        uint256 data = (
            uint256(_chainSpec.epochsPerFrame) << 192 |
            uint256(_chainSpec.slotsPerEpoch) << 128 |
            uint256(_chainSpec.secondsPerSlot) << 64 |
            uint256(_chainSpec.genesisTime)
        );

        BEACON_SPEC_POSITION.setStorageUint256(data);
    }

    function _getNewOracleChainSpec(address _newOracle)
        internal
        view
        returns (ChainSpec memory spec)
    {
        IHashConsensus consensus = IHashConsensus(INewOracle(_newOracle).getConsensusContract());
        (uint256 slotsPerEpoch, uint256 secondsPerSlot, uint256 genesisTime) = consensus.getChainConfig();
        (, uint256 epochsPerFrame_) = IHashConsensus(consensus).getFrameConfig();

        spec.epochsPerFrame = uint64(epochsPerFrame_);
        spec.slotsPerEpoch = uint64(slotsPerEpoch);
        spec.secondsPerSlot = uint64(secondsPerSlot);
        spec.genesisTime = uint64(genesisTime);
    }

    function _getCurrentFrameFromNewOracle()
        internal
        view
        returns (
            uint256 frameEpochId,
            uint256 frameStartTime,
            uint256 frameEndTime
        )
    {
        ChainSpec memory spec = _getChainSpec();
        IHashConsensus consensus = _getNewConsensusContract();
        uint256 refSlot;
        (refSlot, frameEndTime) =  consensus.getCurrentFrame();
        // new oracle's frame ends at the timestamp of the frame's last slot; old oracle's frame
        // ended a second before the timestamp of the first slot of the next frame
        frameEndTime += spec.secondsPerSlot - 1;
        // new oracle's ref. slot is the last slot of the epoch preceding the one the frame starts at
        frameStartTime = spec.genesisTime + (refSlot + 1) * spec.secondsPerSlot;
        frameEpochId = (refSlot + 1) / spec.slotsPerEpoch;
    }

    function _getNewConsensusContract() internal view returns (IHashConsensus) {
        return IHashConsensus(INewOracle(getNewOracle()).getConsensusContract());
    }
}
