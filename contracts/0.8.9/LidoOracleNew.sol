// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { ERC165Checker } from "@openzeppelin/contracts-v4.4/utils/introspection/ERC165Checker.sol";
import { AccessControlEnumerable } from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

import "./CommitteeQuorum.sol";
import "./ReportEpochChecker.sol";
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
contract LidoOracleNew is CommitteeQuorum, AccessControlEnumerable, ReportEpochChecker {
    using ERC165Checker for address;
    using UnstructuredStorage for bytes32;

    event AllowedBeaconBalanceAnnualRelativeIncreaseSet(uint256 value);
    event AllowedBeaconBalanceRelativeDecreaseSet(uint256 value);
    event BeaconReportReceiverSet(address callback);

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
         uint256 totalShares
    );

    event ContractVersionSet(uint256 version);


    struct MemberReport {
        // Consensus info
        uint256 epochId;
        // CL values
        uint256 beaconValidators;
        uint64 beaconBalanceGwei;
        uint256 totalExitedValidators;
        uint256[] stakingModuleIds;
        uint256[] nodeOperatorsWithExitedValidators;
        uint64[] exitedValidatorsNumbers;
        // EL values
        uint256 wcBufferedEther;
        // decision
        uint256 newDepositBufferWithdrawalsReserve;
        uint256[] requestIdToFinalizeUpTo;
        uint256[] finalizationPooledEtherAmount;
        uint256[] finalizationSharesAmount;
    }

    /// ACL
    bytes32 constant public MANAGE_MEMBERS_ROLE = keccak256("MANAGE_MEMBERS_ROLE");
    bytes32 constant public MANAGE_QUORUM_ROLE = keccak256("MANAGE_QUORUM_ROLE");
    bytes32 constant public SET_BEACON_SPEC_ROLE = keccak256("SET_BEACON_SPEC_ROLE");
    bytes32 constant public SET_REPORT_BOUNDARIES_ROLE = keccak256("SET_REPORT_BOUNDARIES_ROLE");
    bytes32 constant public SET_BEACON_REPORT_RECEIVER_ROLE = keccak256("SET_BEACON_REPORT_RECEIVER_ROLE");

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

    /// Address of the Lido contract
    bytes32 internal constant LIDO_POSITION =
        0xf6978a4f7e200f6d3a24d82d44c48bddabce399a3b8ec42a480ea8a2d5fe6ec5; // keccak256("lido.LidoOracle.lido")

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION =
        0x75be19a3f314d89bd1f84d30a6c84e2f1cd7afc7b6ca21876564c265113bb7e4; // keccak256("lido.LidoOracle.contractVersion")

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


    /**
     * @notice Initialize the contract (version 3 for now) from scratch
     * @dev For details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
     * @param _admin Admin which can modify OpenZeppelin role holders
     * @param _lido Address of Lido contract
     * @param _epochsPerFrame Number of epochs per frame
     * @param _slotsPerEpoch Number of slots per epoch
     * @param _secondsPerSlot Number of seconds per slot
     * @param _genesisTime Genesis time
     * @param _allowedBeaconBalanceAnnualRelativeIncrease Allowed beacon balance annual relative increase (e.g. 1000 means 10% increase)
     * @param _allowedBeaconBalanceRelativeDecrease Allowed beacon balance instantaneous decrease (e.g. 500 means 5% decrease)
     */
    function initialize(
        address _admin,
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
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) {
            revert CanInitializeOnlyOnZeroVersion();
        }
        CONTRACT_VERSION_POSITION.setStorageUint256(1);

        if (_admin == address(0)) { revert ZeroAdminAddress(); }
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);

        LIDO_POSITION.setStorageAddress(_lido);

        _setQuorum(1);

        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceAnnualRelativeIncrease);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_allowedBeaconBalanceAnnualRelativeIncrease);

        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceRelativeDecrease);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_allowedBeaconBalanceRelativeDecrease);

        _setBeaconSpec(_epochsPerFrame, _slotsPerEpoch, _secondsPerSlot, _genesisTime);

        // set expected epoch to the first epoch for the next frame
        _setExpectedEpochToFirstOfNextFrame();
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
    function setAllowedBeaconBalanceAnnualRelativeIncrease(uint256 _value)
        external onlyRole(SET_BEACON_REPORT_RECEIVER_ROLE)
    {
        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.setStorageUint256(_value);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_value);
    }

    /**
     * @notice Set the lower bound of the reported balance possible decrease to `_value`
     */
    function setAllowedBeaconBalanceRelativeDecrease(uint256 _value)
        external onlyRole(SET_REPORT_BOUNDARIES_ROLE)
    {
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
    function getMemberReport(uint256 _index)
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
    function setBeaconReportReceiver(address _addr)
        external onlyRole(SET_BEACON_REPORT_RECEIVER_ROLE)
    {
        if(_addr != address(0)) {
            IBeaconReportReceiver iBeacon;
            if (!_addr.supportsInterface(iBeacon.processLidoOracleReport.selector)) {
                revert BadBeaconReportReceiver();
            }
        }

        BEACON_REPORT_RECEIVER_POSITION.setStorageAddress(_addr);
        emit BeaconReportReceiverSet(_addr);
    }

    /**
     * @notice Return the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
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
     * @notice Return last completed epoch
     */
    function getLastCompletedEpochId() external view returns (uint256) {
        return LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256();
    }


    function setAdmin(address _newAdmin)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // TODO: remove this temporary function

        _grantRole(DEFAULT_ADMIN_ROLE, _newAdmin);
        _revokeRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Add `_member` to the oracle member committee list
     */
    function addOracleMember(address _member)
        external onlyRole(MANAGE_MEMBERS_ROLE)
    {
        _addOracleMember(_member);
    }

    /**
     * @notice Remove '_member` from the oracle member committee list
     */
    function removeOracleMember(address _member)
        external onlyRole(MANAGE_MEMBERS_ROLE)
    {
        _removeOracleMember(_member);
    }

    function reportBeacon(
        MemberReport calldata _report
    ) external {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        bool hasEpochAdvanced = _validateAndUpdateExpectedEpoch(_report.epochId, beaconSpec);
        if (hasEpochAdvanced) {
            _clearReporting();
        }

        if (_handleMemberReport(msg.sender, _encodeReport(_report))) {
            _handleConsensussedReport(_report, beaconSpec);
        }

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
    }

    function _decodeReport(bytes memory _reportData) internal pure returns (
        MemberReport memory report
    ) {
        report = abi.decode(_reportData, (MemberReport));
    }

    function _encodeReport(MemberReport memory _report) internal pure returns (
        bytes memory reportData
    ) {
        reportData = abi.encode(_report);
    }

    /**
     * @notice Set the number of exactly the same reports needed to finalize the epoch to `_quorum`
     */
    function updateQuorum(uint256 _quorum)
        external onlyRole(MANAGE_QUORUM_ROLE)
    {
        (bool isQuorum, uint256 reportIndex) = _updateQuorum(_quorum);
        if (isQuorum) {
            MemberReport memory report = _decodeReport(distinctReports[reportIndex]);
            _handleConsensussedReport(report, _getBeaconSpec());
        }
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
        external onlyRole(SET_BEACON_SPEC_ROLE)
    {
        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );
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

        // TODO: maybe add additional report validity sanity checks

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
        _advanceExpectedEpoch(_report.epochId + _beaconSpec.epochsPerFrame);
        _clearReporting();

        ILido lido = getLido();
        INodeOperatorsRegistry registry = lido.getOperators();
        for (uint256 i = 0; i < _report.exitedValidatorsNumbers.length; ++i) {
            registry.reportStoppedValidators(
                _report.nodeOperatorsWithExitedValidators[i],
                _report.exitedValidatorsNumbers[i]
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
            if (uint256(10000 * 365 days) * (_postTotalPooledEther - _preTotalPooledEther) >
                allowedAnnualRelativeIncreaseBp * _preTotalPooledEther * _timeElapsed)
            {
                revert AllowedBeaconBalanceIncreaseExceeded();
            }
        } else {
            // decrease           = _preTotalPooledEther - _postTotalPooledEther
            // relativeDecrease   = decrease / _preTotalPooledEther
            // relativeDecreaseBp = relativeDecrease * 10000, in basis points 0.01% (1e-4)
            uint256 allowedRelativeDecreaseBp =
                ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.getStorageUint256();
            // check that relativeDecreaseBp <= allowedRelativeDecreaseBp
            if (uint256(10000) * (_preTotalPooledEther - _postTotalPooledEther) >
                allowedRelativeDecreaseBp * _preTotalPooledEther)
            {
                revert AllowedBeaconBalanceDecreaseExceeded();
            }
        }
    }

    error CanInitializeOnlyOnZeroVersion();
    error ZeroAdminAddress();
    error BadBeaconReportReceiver();
    error AllowedBeaconBalanceIncreaseExceeded();
    error AllowedBeaconBalanceDecreaseExceeded();

}
