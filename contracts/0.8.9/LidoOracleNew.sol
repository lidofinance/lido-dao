// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "./CommitteeQuorum.sol";
import "./interfaces/ILido.sol";
import "./interfaces/IBeaconReportReceiver.sol";


/**
 * @title Implementation of an ETH 2.0 -> ETH oracle
 *
 * The goal of the oracle is to inform other parts of the system about balances controlled by the
 * DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down
 * because of slashing.
 *
 * The timeline is divided into consecutive frames. Every oracle member may push its report once
 * per frame. When the equal reports reach the configurable 'quorum' value, this frame is
 * considered finalized and the resulting report is pushed to Lido.
 *
 * Not all frames may come to a quorum. Oracles may report only to the first epoch of the frame and
 * only if no quorum is reached for this epoch yet.
 */
contract LidoOracleNew is CommitteeQuorum {
    // using ERC165Checker for address;
    using UnstructuredStorage for bytes32;

    event AllowedBeaconBalanceAnnualRelativeIncreaseSet(uint256 value);
    event AllowedBeaconBalanceRelativeDecreaseSet(uint256 value);
    event BeaconReportReceiverSet(address callback);
    event ExpectedEpochIdUpdated(uint256 epochId);
    event BeaconSpecSet(
        uint64 epochsPerFrame,
        uint64 slotsPerEpoch,
        uint64 secondsPerSlot,
        uint64 genesisTime
    );
    event BeaconReported(
        uint256 epochId,
        uint256 beaconBalance,
        uint256 beaconValidators,
        address caller,
        uint256 totalExitedValidators,
        uint256 wcBufferedEther,
        uint256[] requestIdToFinalizeUpTo,
        uint256[] finalizationPooledEtherAmount,
        uint256[] finalizationSharesAmount
    );
    event Completed(
        uint256 epochId,
        uint256 beaconBalance,
        uint256 beaconValidators,
        uint256 totalExitedValidators,
        uint256 wcBufferedEther,
        uint256[] requestIdToFinalizeUpTo,
        uint256[] finalizationPooledEtherAmount,
        uint256[] finalizationSharesAmount
    );
    event PostTotalShares(
         uint256 postTotalPooledEther,
         uint256 preTotalPooledEther,
         uint256 timeElapsed,
         uint256 totalShares);
    event ContractVersionSet(uint256 version);


    struct MemberReport {
        // Consensus info
        uint256 epochId;
        // CL values
        uint256 beaconValidators;
        // uint256 beaconBalanceGwei;
        uint64 beaconBalanceGwei;
        uint256 totalExitedValidators;
        uint256[] stakingModuleIds;
        uint256[] nodeOperatorsWithExitedValidators;
        uint256[] exitedValidatorsNumbers;
        // EL values
        uint256 wcBufferedEther;
        // decision
        uint256 newDepositBufferWithdrawalsReserve;
        uint256[] requestIdToFinalizeUpTo;
        uint256[] finalizationPooledEtherAmount;
        uint256[] finalizationSharesAmount;
    }

    struct BeaconSpec {
        uint64 epochsPerFrame;
        uint64 slotsPerEpoch;
        uint64 secondsPerSlot;
        uint64 genesisTime;
    }

    /// ACL

    /// temporary owner for testnet
    address public owner;

    bytes32 constant public MANAGE_MEMBERS =
        0xbf6336045918ae0015f4cdb3441a2fdbfaa4bcde6558c8692aac7f56c69fb067; // keccak256("MANAGE_MEMBERS")
    bytes32 constant public MANAGE_QUORUM =
        0xa5ffa9f45fa52c446078e834e1914561bd9c2ab1e833572d62af775da092ccbc; // keccak256("MANAGE_QUORUM")
    bytes32 constant public SET_BEACON_SPEC =
        0x16a273d48baf8111397316e6d961e6836913acb23b181e6c5fb35ec0bd2648fc; // keccak256("SET_BEACON_SPEC")
    bytes32 constant public SET_REPORT_BOUNDARIES =
        0x44adaee26c92733e57241cb0b26ffaa2d182ed7120ba3ecd7e0dce3635c01dc1; // keccak256("SET_REPORT_BOUNDARIES")
    bytes32 constant public SET_BEACON_REPORT_RECEIVER =
        0xe22a455f1bfbaf705ac3e891a64e156da92cb0b42cfc389158e6e82bd57f37be; // keccak256("SET_BEACON_REPORT_RECEIVER")

    /// Eth1 denomination is 18 digits, while Eth2 has 9 digits. Because we work with Eth2
    /// balances and to support old interfaces expecting eth1 format, we multiply by this
    /// coefficient.
    uint128 internal constant DENOMINATION_OFFSET = 1e9;


    /// Historic data about 2 last completed reports and their times
    bytes32 internal constant POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0xaa8433b13d2b111d4f84f6f374bc7acbe20794944308876aa250fa9a73dc7f53; // keccak256("lido.LidoOracle.postCompletedTotalPooledEther")
    bytes32 internal constant PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0x1043177539af09a67d747435df3ff1155a64cd93a347daaac9132a591442d43e; // keccak256("lido.LidoOracle.preCompletedTotalPooledEther")
    bytes32 internal constant LAST_COMPLETED_EPOCH_ID_POSITION =
        0xdad15c0beecd15610092d84427258e369d2582df22869138b4c5265f049f574c; // keccak256("lido.LidoOracle.lastCompletedEpochId")
    bytes32 internal constant TIME_ELAPSED_POSITION =
        0x8fe323f4ecd3bf0497252a90142003855cc5125cee76a5b5ba5d508c7ec28c3a; // keccak256("lido.LidoOracle.timeElapsed")

    /// This is a dead variable: it was used only in v1 and in upgrade v1 --> v2
    /// Just keep in mind that storage at this position is occupied but with no actual usage
    bytes32 internal constant V1_LAST_REPORTED_EPOCH_ID_POSITION =
        0xfe0250ed0c5d8af6526c6d133fccb8e5a55dd6b1aa6696ed0c327f8e517b5a94; // keccak256("lido.LidoOracle.lastReportedEpochId")


    /// Address of the Lido contract
    bytes32 internal constant LIDO_POSITION =
        0xf6978a4f7e200f6d3a24d82d44c48bddabce399a3b8ec42a480ea8a2d5fe6ec5; // keccak256("lido.LidoOracle.lido")

    /// Storage for the actual beacon chain specification
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

    /// Epoch that we currently collect reports
    bytes32 internal constant EXPECTED_EPOCH_ID_POSITION =
        0x65f1a0ee358a8a4000a59c2815dc768eb87d24146ca1ac5555cb6eb871aee915; // keccak256("lido.LidoOracle.expectedEpochId")

    /// Receiver address to be called when the report is pushed to Lido
    bytes32 internal constant BEACON_REPORT_RECEIVER_POSITION =
        0xb59039ed37776bc23c5d272e10b525a957a1dfad97f5006c84394b6b512c1564; // keccak256("lido.LidoOracle.beaconReportReceiver")

    /// Upper bound of the reported balance possible increase in APR, controlled by the governance
    bytes32 internal constant ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION =
        0x613075ab597bed8ce2e18342385ce127d3e5298bc7a84e3db68dc64abd4811ac; // keccak256("lido.LidoOracle.allowedBeaconBalanceAnnualRelativeIncrease")

    /// Lower bound of the reported balance possible decrease, controlled by the governance
    ///
    /// @notice When slashing happens, the balance may decrease at a much faster pace. Slashing are
    /// one-time events that decrease the balance a fair amount - a few percent at a time in a
    /// realistic scenario. Thus, instead of sanity check for an APR, we check if the plain relative
    /// decrease is within bounds.  Note that it's not annual value, its just one-jump value.
    bytes32 internal constant ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION =
        0x92ba7776ed6c5d13cf023555a94e70b823a4aebd56ed522a77345ff5cd8a9109; // keccak256("lido.LidoOracle.allowedBeaconBalanceDecrease")


    constructor() {
        owner = msg.sender;
    }

    function _checkSenderIsOwner() internal {
        require(msg.sender == owner, "ONLY_OWNER_SENDER_ALLOWED");
    }

    /**
     * @notice Return the Lido contract address
     */
    function getLido() public view returns (ILido) {
        return ILido(LIDO_POSITION.getStorageAddress());
    }

    /**
     * @notice Return the upper bound of the reported balance possible increase in APR
     */
    function getAllowedBeaconBalanceAnnualRelativeIncrease() external view returns (uint256) {
        return ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the lower bound of the reported balance possible decrease
     */
    function getAllowedBeaconBalanceRelativeDecrease() external view returns (uint256) {
        return ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.getStorageUint256();
    }

    /**
     * @notice Set the upper bound of the reported balance possible increase in APR to `_value`
     */
    function setAllowedBeaconBalanceAnnualRelativeIncrease(uint256 _value) external {
        // TODO: auth(SET_BEACON_REPORT_RECEIVER)
        _checkSenderIsOwner();

        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.setStorageUint256(_value);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_value);
    }

    /**
     * @notice Set the lower bound of the reported balance possible decrease to `_value`
     */
    function setAllowedBeaconBalanceRelativeDecrease(uint256 _value) external  {
        // TODO: auth(SET_REPORT_BOUNDARIES)
        _checkSenderIsOwner();

        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.setStorageUint256(_value);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_value);
    }

    /**
     * @notice Return the receiver contract address to be called when the report is pushed to Lido
     */
    function getBeaconReportReceiver() external view returns (address) {
        return BEACON_REPORT_RECEIVER_POSITION.getStorageAddress();
    }

    /**
     * @notice Return the current reporting array element with index `_index`
     */
    function getCurrentReportVariant(uint256 _index)
        external
        view
        returns (
            MemberReport memory report
        )
    {
        report = _decodeReport(distinctReports[_index]);
    }

    /**
     * @notice Set the receiver contract address to `_addr` to be called when the report is pushed
     * @dev Specify 0 to disable this functionality
     */
    function setBeaconReportReceiver(address _addr) external {
        // TODO: auth(SET_BEACON_REPORT_RECEIVER)
        _checkSenderIsOwner();
        if(_addr != address(0)) {
            IBeaconReportReceiver iBeacon;
            // TODO: restore check
            // require(
            //     _addr._supportsInterface(iBeacon.processLidoOracleReport.selector),
            //     "BAD_BEACON_REPORT_RECEIVER"
            // );
        }

        BEACON_REPORT_RECEIVER_POSITION.setStorageAddress(_addr);
        emit BeaconReportReceiverSet(_addr);
    }

    /**
     * @notice Returns epoch that can be reported by oracles
     */
    function getExpectedEpochId() external view returns (uint256) {
        return EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    /**
     * @notice Return beacon specification data
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
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        return (
            beaconSpec.epochsPerFrame,
            beaconSpec.slotsPerEpoch,
            beaconSpec.secondsPerSlot,
            beaconSpec.genesisTime
        );
    }

    /**
     * @notice Update beacon specification data
     */
    function setBeaconSpec(
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        external
    {
        // TODO: auth(SET_BEACON_SPEC)
        _checkSenderIsOwner();

        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );
    }

    /**
     * @notice Return the epoch calculated from current timestamp
     */
    function getCurrentEpochId() external view returns (uint256) {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        return _getCurrentEpochId(beaconSpec);
    }

    /**
     * @notice Return currently reportable epoch (the first epoch of the current frame) as well as
     * its start and end times in seconds
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
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint64 genesisTime = beaconSpec.genesisTime;
        uint64 secondsPerEpoch = beaconSpec.secondsPerSlot * beaconSpec.slotsPerEpoch;

        frameEpochId = _getFrameFirstEpochId(_getCurrentEpochId(beaconSpec), beaconSpec);
        frameStartTime = frameEpochId * secondsPerEpoch + genesisTime;
        frameEndTime = (frameEpochId + beaconSpec.epochsPerFrame) * secondsPerEpoch + genesisTime - 1;
    }

    /**
     * @notice Return last completed epoch
     */
    function getLastCompletedEpochId() external view returns (uint256) {
        return LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256();
    }


    /**
     * @notice Report beacon balance and its change during the last frame
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

    /**
     * @notice Initialize the contract (version 3 for now) from scratch
     * @dev For details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
     * @param _lido Address of Lido contract
     * @param _epochsPerFrame Number of epochs per frame
     * @param _slotsPerEpoch Number of slots per epoch
     * @param _secondsPerSlot Number of seconds per slot
     * @param _genesisTime Genesis time
     * @param _allowedBeaconBalanceAnnualRelativeIncrease Allowed beacon balance annual relative increase (e.g. 1000 means 10% increase)
     * @param _allowedBeaconBalanceRelativeDecrease Allowed beacon balance instantaneous decrease (e.g. 500 means 5% decrease)
     */
    function initialize(
        address _lido,
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime,
        uint256 _allowedBeaconBalanceAnnualRelativeIncrease,
        uint256 _allowedBeaconBalanceRelativeDecrease
    )
        external
    {
        assert(1 == ((1 << (MAX_MEMBERS - 1)) >> (MAX_MEMBERS - 1)));  // static assert

        // We consider storage state right after deployment (no initialize() called yet) as version 0

        // Initializations for v0 --> v1
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "BASE_VERSION_MUST_BE_ZERO");

        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );

        LIDO_POSITION.setStorageAddress(_lido);

        QUORUM_POSITION.setStorageUint256(1);
        emit QuorumChanged(1);

        // Initializations for v1 --> v2
        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceAnnualRelativeIncrease);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_allowedBeaconBalanceAnnualRelativeIncrease);

        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceRelativeDecrease);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_allowedBeaconBalanceRelativeDecrease);

        // set expected epoch to the first epoch for the next frame
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint256 expectedEpoch = _getFrameFirstEpochId(0, beaconSpec) + beaconSpec.epochsPerFrame;
        EXPECTED_EPOCH_ID_POSITION.setStorageUint256(expectedEpoch);
        emit ExpectedEpochIdUpdated(expectedEpoch);

        CONTRACT_VERSION_POSITION.setStorageUint256(1);
    }


    /**
     * @notice Add `_member` to the oracle member committee list
     */
    function addOracleMember(address _member) external {
        // TODO: auth(MANAGE_MEMBERS)
        _checkSenderIsOwner();

        _addOracleMember(_member);
    }

    /**
     * @notice Remove '_member` from the oracle member committee list
     */
    function removeOracleMember(address _member) external {
        // TODO: auth(MANAGE_MEMBERS)
        _checkSenderIsOwner();

        _removeOracleMember(_member);
    }

    function reportBeacon(
        MemberReport calldata _report
    ) external {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        _validateExpectedEpochAndClearReportingIfNeeded(_report.epochId, beaconSpec);

        uint128 beaconBalance = DENOMINATION_OFFSET * uint128(_report.beaconBalanceGwei);
        emit BeaconReported(
            _report.epochId,
            beaconBalance,
            _report.beaconValidators,
            msg.sender,
            _report.totalExitedValidators,
            _report.wcBufferedEther,
            _report.requestIdToFinalizeUpTo,
            _report.finalizationPooledEtherAmount,
            _report.finalizationSharesAmount
        );

        if (_handleMemberReport(msg.sender, _encodeReport(_report))) {
            _handleConsensussedReport(_report, beaconSpec);
        }
    }

    function _decodeReport(bytes memory _reportData) internal view returns (
        MemberReport memory report
    ) {
        report = abi.decode(_reportData, (MemberReport));
    }

    function _encodeReport(MemberReport memory _report) internal view returns (
        bytes memory reportData
    ) {
        reportData = abi.encode(_report);
    }

    /**
     * @notice Set the number of exactly the same reports needed to finalize the epoch to `_quorum`
     */
    function setQuorum(uint256 _quorum) external {
        // TODO: auth(MANAGE_QUORUM)
        _checkSenderIsOwner();

        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();

        _setQuorum(_quorum);

        // If the quorum value lowered, check existing reports whether it is time to push
        if (oldQuorum > _quorum) {
            (bool isQuorum, uint256 reportIndex) = _getQuorumReport(_quorum);
            if (isQuorum) {
                MemberReport memory report = _decodeReport(distinctReports[reportIndex]);
                _handleConsensussedReport(report, _getBeaconSpec());
            }
        }
    }

    function _validateExpectedEpochAndClearReportingIfNeeded(uint256 _epochId, BeaconSpec memory _beaconSpec) private
    {
        uint256 expectedEpoch = EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
        require(_epochId >= expectedEpoch, "EPOCH_IS_TOO_OLD");

        // if expected epoch has advanced, check that this is the first epoch of the current frame
        // and clear the last unsuccessful reporting
        if (_epochId > expectedEpoch) {
            require(_epochId == _getFrameFirstEpochId(_getCurrentEpochId(_beaconSpec), _beaconSpec), "UNEXPECTED_EPOCH");
            _clearReportingAndAdvanceTo(_epochId);
        }
    }

    /**
     * @notice Return beacon specification data
     */
    function _getBeaconSpec()
        internal
        view
        returns (BeaconSpec memory beaconSpec)
    {
        uint256 data = BEACON_SPEC_POSITION.getStorageUint256();
        beaconSpec.epochsPerFrame = uint64(data >> 192);
        beaconSpec.slotsPerEpoch = uint64(data >> 128);
        beaconSpec.secondsPerSlot = uint64(data >> 64);
        beaconSpec.genesisTime = uint64(data);
        return beaconSpec;
    }

    /**
     * @notice Set beacon specification data
     */
    function _setBeaconSpec(
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        internal
    {
        require(_epochsPerFrame > 0, "BAD_EPOCHS_PER_FRAME");
        require(_slotsPerEpoch > 0, "BAD_SLOTS_PER_EPOCH");
        require(_secondsPerSlot > 0, "BAD_SECONDS_PER_SLOT");
        require(_genesisTime > 0, "BAD_GENESIS_TIME");

        uint256 data = (
            uint256(_epochsPerFrame) << 192 |
            uint256(_slotsPerEpoch) << 128 |
            uint256(_secondsPerSlot) << 64 |
            uint256(_genesisTime)
        );
        BEACON_SPEC_POSITION.setStorageUint256(data);
        emit BeaconSpecSet(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime);
    }


    // /**
    //  * @notice Push the given report to Lido and performs accompanying accounting
    //  * @param _epochId Beacon chain epoch, proven to be >= expected epoch and <= current epoch
    //  * @param _beaconBalanceEth1 Validators balance in eth1 (18-digit denomination)
    //  * @param _beaconSpec current beacon specification data
    //  */
    function _handleConsensussedReport(
        MemberReport memory _report,
        BeaconSpec memory _beaconSpec
    )
        internal
    {
        uint128 beaconBalance = DENOMINATION_OFFSET * uint128(_report.beaconBalanceGwei);

        emit Completed(
            _report.epochId,
            beaconBalance,
            _report.beaconValidators,
            _report.totalExitedValidators,
            _report.wcBufferedEther,
            _report.requestIdToFinalizeUpTo,
            _report.finalizationPooledEtherAmount,
            _report.finalizationSharesAmount
        );

        // now this frame is completed, so the expected epoch should be advanced to the first epoch
        // of the next frame
        _clearReportingAndAdvanceTo(_report.epochId + _beaconSpec.epochsPerFrame);

        ILido lido = getLido();
        INodeOperatorsRegistry registry = lido.getOperators();
        for (uint256 i = 0; i < _report.exitedValidatorsNumbers.length; ++i) {
            // TODO: accept uint64 in reportBeacon?
            uint256 stoppedIncrement = _report.exitedValidatorsNumbers[i];
            require(stoppedIncrement < type(uint64).max, "EXITED_VALIDATORS_NUMBER_BEYOND_LIMIT");
            registry.reportStoppedValidators(
                _report.nodeOperatorsWithExitedValidators[i],
                uint64(stoppedIncrement)
            );
        }

        // report to the Lido and collect stats
        uint256 prevTotalPooledEther = lido.totalSupply();

        // TODO: report other values from MemberReport
        lido.handleOracleReport(
            _report.beaconValidators,
            beaconBalance,
            _report.totalExitedValidators,
            _report.wcBufferedEther,
            _report.newDepositBufferWithdrawalsReserve,
            _report.requestIdToFinalizeUpTo,
            _report.finalizationPooledEtherAmount,
            _report.finalizationSharesAmount
        );
        uint256 postTotalPooledEther = lido.totalSupply();

        _doWorkAfterReportingToLido(
            prevTotalPooledEther,
            postTotalPooledEther,
            _report.epochId,
            _beaconSpec
        );
    }


    function _doWorkAfterReportingToLido(
        uint256 _prevTotalPooledEther,
        uint256 _postTotalPooledEther,
        uint256 _epochId,
        BeaconSpec memory _beaconSpec
    ) internal {
        PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(_prevTotalPooledEther);
        POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(_postTotalPooledEther);
        uint256 timeElapsed = (_epochId - LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256()) *
            _beaconSpec.slotsPerEpoch * _beaconSpec.secondsPerSlot;
        TIME_ELAPSED_POSITION.setStorageUint256(timeElapsed);
        LAST_COMPLETED_EPOCH_ID_POSITION.setStorageUint256(_epochId);

        // rollback on boundaries violation
        _reportSanityChecks(_postTotalPooledEther, _prevTotalPooledEther, timeElapsed);

        // emit detailed statistics and call the quorum delegate with this data
        emit PostTotalShares(_postTotalPooledEther, _prevTotalPooledEther, timeElapsed, getLido().getTotalShares());
        IBeaconReportReceiver receiver = IBeaconReportReceiver(BEACON_REPORT_RECEIVER_POSITION.getStorageAddress());
        if (address(receiver) != address(0)) {
            receiver.processLidoOracleReport(_postTotalPooledEther, _prevTotalPooledEther, timeElapsed);
        }
    }

    /**
     * @notice Remove the current reporting progress and advances to accept the later epoch `_epochId`
     */
    function _clearReportingAndAdvanceTo(uint256 _epochId) internal {
        _clearReporting();

        EXPECTED_EPOCH_ID_POSITION.setStorageUint256(_epochId);
        emit ExpectedEpochIdUpdated(_epochId);
    }

    /**
     * @notice Performs logical consistency check of the Lido changes as the result of reports push
     * @dev To make oracles less dangerous, we limit rewards report by 10% _annual_ increase and 5%
     * _instant_ decrease in stake, with both values configurable by the governance in case of
     * extremely unusual circumstances.
     **/
    function _reportSanityChecks(
        uint256 _postTotalPooledEther,
        uint256 _preTotalPooledEther,
        uint256 _timeElapsed)
        internal
        view
    {
        // TODO: update sanity checks
        if (_postTotalPooledEther >= _preTotalPooledEther) {
            // increase                 = _postTotalPooledEther - _preTotalPooledEther,
            // relativeIncrease         = increase / _preTotalPooledEther,
            // annualRelativeIncrease   = relativeIncrease / (timeElapsed / 365 days),
            // annualRelativeIncreaseBp = annualRelativeIncrease * 10000, in basis points 0.01% (1e-4)
            uint256 allowedAnnualRelativeIncreaseBp =
                ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.getStorageUint256();
            // check that annualRelativeIncreaseBp <= allowedAnnualRelativeIncreaseBp
            require(uint256(10000 * 365 days) * (_postTotalPooledEther - _preTotalPooledEther) <=
                    allowedAnnualRelativeIncreaseBp * _preTotalPooledEther * _timeElapsed,
                    "ALLOWED_BEACON_BALANCE_INCREASE");
        } else {
            // decrease           = _preTotalPooledEther - _postTotalPooledEther
            // relativeDecrease   = decrease / _preTotalPooledEther
            // relativeDecreaseBp = relativeDecrease * 10000, in basis points 0.01% (1e-4)
            uint256 allowedRelativeDecreaseBp =
                ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.getStorageUint256();
            // check that relativeDecreaseBp <= allowedRelativeDecreaseBp
            require(uint256(10000) * (_preTotalPooledEther - _postTotalPooledEther) <=
                    allowedRelativeDecreaseBp * _preTotalPooledEther,
                    "ALLOWED_BEACON_BALANCE_DECREASE");
        }
    }

    /**
     * @notice Return the epoch calculated from current timestamp
     */
    function _getCurrentEpochId(BeaconSpec memory _beaconSpec) internal view returns (uint256) {
        return (_getTime() - _beaconSpec.genesisTime) / (_beaconSpec.slotsPerEpoch * _beaconSpec.secondsPerSlot);
    }

    /**
     * @notice Return the first epoch of the frame that `_epochId` belongs to
     */
    function _getFrameFirstEpochId(uint256 _epochId, BeaconSpec memory _beaconSpec) internal view returns (uint256) {
        return _epochId / _beaconSpec.epochsPerFrame * _beaconSpec.epochsPerFrame;
    }

    /**
     * @notice Return the current timestamp
     */
    function _getTime() internal virtual view returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }
}
