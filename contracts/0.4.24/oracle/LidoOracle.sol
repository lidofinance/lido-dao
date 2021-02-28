// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";

import "../interfaces/ILido.sol";
import "../interfaces/ILidoOracle.sol";
import "../interfaces/IQuorumCallback.sol";
import "../interfaces/ISTETH.sol";


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
 * either to the current 'reportable' epoch or any later one up to now.
 */
contract LidoOracle is ILidoOracle, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;

    struct BeaconSpec {
        uint64 epochsPerFrame;
        uint64 slotsPerEpoch;
        uint64 secondsPerSlot;
        uint64 genesisTime;
    }

    struct Report {
        uint128 beaconBalance;
        uint128 beaconValidators;
    }

    struct ReportKind {
        Report report;
        uint256 count;
    }

    /// ACL
    bytes32 constant public MANAGE_MEMBERS = keccak256("MANAGE_MEMBERS");
    bytes32 constant public MANAGE_QUORUM = keccak256("MANAGE_QUORUM");
    bytes32 constant public SET_BEACON_SPEC = keccak256("SET_BEACON_SPEC");
    bytes32 constant public SET_REPORT_BOUNDARIES = keccak256("SET_REPORT_BOUNDARIES");
    bytes32 constant public SET_QUORUM_CALLBACK = keccak256("SET_QUORUM_CALLBACK");

    /// @dev Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

    /// @dev oracle committee members
    address[] private members;
    /// @dev number of the committee members required to finalize a data point
    bytes32 internal constant QUORUM_POSITION = keccak256("lido.LidoOracle.quorum");

    /// @dev link to the Lido contract
    bytes32 internal constant LIDO_POSITION = keccak256("lido.LidoOracle.lido");

    /// @dev storage for actual beacon chain specs
    bytes32 internal constant BEACON_SPEC_POSITION = keccak256("lido.LidoOracle.beaconSpec");

    /// @dev storage for all gathered reports for the last epoch
    bytes32 internal constant REPORTABLE_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.reportableEpochId");
    bytes32 internal constant REPORTS_BITMASK_POSITION = keccak256("lido.LidoOracle.reportsBitMask");
    ReportKind[] private gatheredReportKinds;

    /// @dev historic data about 2 last completed reports
    bytes32 internal constant POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        keccak256("lido.LidoOracle.postCompletedTotalPooledEther");
    bytes32 internal constant PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        keccak256("lido.LidoOracle.preCompletedTotalPooledEther");
    bytes32 internal constant LAST_COMPLETED_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.lastCompletedEpochId");
    bytes32 internal constant TIME_ELAPSED_POSITION = keccak256("lido.LidoOracle.timeElapsed");

    /// @dev function credentials to be called when the quorum is reached
    bytes32 internal constant QUORUM_CALLBACK_POSITION = keccak256("lido.LidoOracle.quorumCallback");

    /**
     * If we use APR as a basic reference for increase, and expected range is below 10% APR.
     * May be changed by the governance.
     */
    bytes32 internal constant ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION =
        keccak256("lido.LidoOracle.allowedBeaconBalanceAnnualRelativeIncrease");
    uint256 public constant DEFAULT_ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE = 100000;  // PPM ~ 10%

    /**
     * When slashing happens, the balance may decrease at a much faster pace.  Slashing are
     * one-time events that decrease the balance a fair amount - a few percent at a time in a
     * realistic scenario. Thus, instead of sanity check for an APR, we check if the plain relative
     * decrease is within bounds.  Note that it's not annual value, its just one-jump value.  May
     * be changed by the governance.
     */
    bytes32 internal constant ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION =
        keccak256("lido.LidoOracle.allowedBeaconBalanceDecrease");
    uint256 public constant DEFAULT_ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE = 50000;  // 5% ~ 50000 PPM

    function getAllowedBeaconBalanceAnnualRelativeIncrease() public view returns(uint256) {
        uint256 result = ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.getStorageUint256();
        if (result == 0) return DEFAULT_ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE;
        return result;
    }

    function getAllowedBeaconBalanceRelativeDecrease() public view returns(uint256) {
        uint256 result = ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.getStorageUint256();
        if (result == 0) return DEFAULT_ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE;
        return result;
    }

    function setAllowedBeaconBalanceAnnualRelativeIncrease(uint256 value) public auth(SET_REPORT_BOUNDARIES) {
        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.setStorageUint256(value);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(value);
    }

    function setAllowedBeaconBalanceRelativeDecrease(uint256 value) public auth(SET_REPORT_BOUNDARIES) {
        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.setStorageUint256(value);
        emit AllowedBeaconBalanceRelativeDecreaseSet(value);
    }

    function getCurrentOraclesReportStatus() public view returns(uint256) {
        return REPORTS_BITMASK_POSITION.getStorageUint256();
    }

    function getCurrentReportKindsSize() public view returns(uint256) {
        return gatheredReportKinds.length;
    }

    function getCurrentReportKind(uint256 index)
        public view
        returns(
            uint128 beaconBalance,
            uint128 beaconValidators,
            uint256 count
        ) {
        ReportKind storage kind = gatheredReportKinds[index];
        return (kind.report.beaconBalance, kind.report.beaconValidators, kind.count);
    }

    /// @dev Initialize function removed from v2 because it is invoked only once
    function initialize(address, uint64, uint64, uint64, uint64) public {}

    /**
     * @notice Add `_member` to the oracle member committee
     * @param _member Address of a member to add
     */
    function addOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _getMemberId(_member), "MEMBER_EXISTS");

        members.push(_member);
        emit MemberAdded(_member);
    }

    /**
     * @notice Remove `_member` from the oracle member committee
     * @param _member Address of a member to remove
     */
    function removeOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        uint256 index = _getMemberId(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 last = members.length.sub(1);
        if (index != last) members[index] = members[last];
        members.length--;
        emit MemberRemoved(_member);

        // Nullify the data for the last epoch. Remained oracles will report it again
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        delete gatheredReportKinds;
    }

    /**
     * @notice Set the number of oracle members required to form a data point to `_quorum`
     */
    function setQuorum(uint256 _quorum) external auth(MANAGE_QUORUM) {
        require(0 != _quorum, "QUORUM_WONT_BE_MADE");
        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();
        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);

        // If the quorum value lowered, check existing reports whether it is time to push
        if (oldQuorum > _quorum) {
            (bool isQuorum, Report memory modeReport) = _getQuorumReport();
            if (isQuorum) {
                _push(REPORTABLE_EPOCH_ID_POSITION.getStorageUint256(), modeReport, _getBeaconSpec());
            }
        }
    }

    /**
     * @notice Returns the callback contract address to be called upon quorum
     */
    function getQuorumCallback() public view returns(address) {
        return address(QUORUM_CALLBACK_POSITION.getStorageUint256());
    }

    /**
     * @notice Set the callback contract address to be called upon quorum
     */
    function setQuorumCallback(address _addr) external auth(SET_QUORUM_CALLBACK) {
        QUORUM_CALLBACK_POSITION.setStorageUint256(uint256(_addr));
        emit QuorumCallbackSet(_addr);
    }

    /**
     * @notice An oracle committee member reports data from the ETH 2.0 side
     * @param _epochId Beacon Chain epoch id
     * @param _beaconBalance Balance in wei on the ETH 2.0 side
     * @param _beaconValidators Number of validators visible on this epoch
     */
    function reportBeacon(uint256 _epochId, uint128 _beaconBalance, uint128 _beaconValidators) external {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint256 reportableEpoch = REPORTABLE_EPOCH_ID_POSITION.getStorageUint256();
        require(_epochId >= reportableEpoch, "EPOCH_IS_TOO_OLD");
        require(
             _epochId == getCurrentEpochId() / beaconSpec.epochsPerFrame * beaconSpec.epochsPerFrame,
             "UNEXPECTED_EPOCH"
        );
        emit BeaconReported(_epochId, _beaconBalance, _beaconValidators, msg.sender);

        // If reported epoch has advanced, clear the last unsuccessful reporting
        if (_epochId > reportableEpoch) _clearReportingAndAdvanceTo(_epochId);

        // Make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(msg.sender);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        require(bitMask & mask == 0, "ALREADY_SUBMITTED");
        REPORTS_BITMASK_POSITION.setStorageUint256(bitMask | mask);

        // Push this report to the matching kind
        Report memory report = Report(_beaconBalance, _beaconValidators);
        uint256 reportRaw = reportToUint256(report);

        // so iterate on all report kinds we alredy have, not more then oracle members maximum
        uint256 quorum = getQuorum();
        uint256 i = 0;
        while (i < gatheredReportKinds.length && reportToUint256(gatheredReportKinds[i].report) != reportRaw) ++i;
        if (i < gatheredReportKinds.length) {
            uint256 newCount = gatheredReportKinds[i].count + 1;
            if (newCount >= quorum) {
                _push(_epochId, gatheredReportKinds[i].report, beaconSpec);
            } else {
                gatheredReportKinds[i].count = newCount;
            }
        } else {
            if (quorum == 1) {
                _push(_epochId, report, beaconSpec);
            } else {
                gatheredReportKinds.push(ReportKind(report, 1));
            }
        }
    }

    /**
     * @notice To make oracles less dangerous, we can limit rewards report by 0.1% increase in stake
     * and 15% decrease in stake, with both values configurable by the governance in case of
     * extremely unusual circumstances.
     * daily_reward_rate_PPM = 1e6 * reward / totalPooledEther / days
     *
     * @dev Note, if you deploy the fresh contract (e.g. on testnet) it may fail at the beginning of
     * the work because the initial pooledEther may be small and it's allowed tiny in absolute
     * numbers, but significant in relative numbers. E.g. if the initial balance is as small as 1e12
     * and then it increases to 2*1e12 it is a very small jump in absolute money but in relative
     * numbers, it will be a +100% increase, so just relax boundaries in such case. This problem
     * should never occur in real-world application because the previous contract version is already
     * working and huge balances are already gathered.
     **/
    function _reportSanityChecks(uint256 postTotalPooledEther,
                                 uint256 preTotalPooledEther,
                                 uint256 timeElapsed) internal view {
        if (postTotalPooledEther >= preTotalPooledEther) {  // check profit constraint
            uint256 reward = postTotalPooledEther - preTotalPooledEther;
            uint256 allowedBeaconBalanceAnnualIncreasePPM = getAllowedBeaconBalanceAnnualRelativeIncrease()
                .mul(preTotalPooledEther);
            uint256 rewardAnnualizedPPM = uint256(1e6 * 365 days).mul(reward).div(timeElapsed);
            require(rewardAnnualizedPPM <= allowedBeaconBalanceAnnualIncreasePPM, "ALLOWED_BEACON_BALANCE_INCREASE");
        } else {  // check loss constraint
            uint256 loss = preTotalPooledEther - postTotalPooledEther;
            uint256 allowedBeaconBalanceDecreasePPM = getAllowedBeaconBalanceRelativeDecrease()
                .mul(preTotalPooledEther);
            uint256 lossPPM = uint256(1e6).mul(loss);
            require(lossPPM <= allowedBeaconBalanceDecreasePPM, "ALLOWED_BEACON_BALANCE_DECREASE");
        }
    }

    /**
     * @notice Returns all needed to oracle daemons data
     */
    function getCurrentFrame()
        external view
        returns (
            uint256 frameEpochId,
            uint256 frameStartTime,
            uint256 frameEndTime
        )
    {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint64 genesisTime = beaconSpec.genesisTime;
        uint64 epochsPerFrame = beaconSpec.epochsPerFrame;
        uint64 secondsPerEpoch = beaconSpec.secondsPerSlot.mul(beaconSpec.slotsPerEpoch);

        frameEpochId = getCurrentEpochId().div(epochsPerFrame).mul(epochsPerFrame);
        frameStartTime = frameEpochId.mul(secondsPerEpoch).add(genesisTime);

        uint256 nextFrameEpochId = frameEpochId.div(epochsPerFrame).add(1).mul(epochsPerFrame);
        frameEndTime = nextFrameEpochId.mul(secondsPerEpoch).add(genesisTime).sub(1);
    }

    /**
     * @notice Returns the current oracle member committee
     */
    function getOracleMembers() external view returns (address[]) {
        return members;
    }

    /**
     * @notice Returns the Lido contract address
     */
    function getLido() public view returns (ILido) {
        return ILido(LIDO_POSITION.getStorageAddress());
    }

    /**
     * @notice Set beacon specs
     */
    function setBeaconSpec(
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        public auth(SET_BEACON_SPEC)
    {
        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );
    }

    /**
     * @notice Returns beacon specs
     */
    function getBeaconSpec()
        public
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
     * @notice Returns the number of oracle members required to form a data point
     */
    function getQuorum() public view returns (uint256) {
        return QUORUM_POSITION.getStorageUint256();
    }

    /**
     * @notice Returns the epochId calculated from current timestamp
     */
    function getCurrentEpochId() public view returns (uint256) {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        return (
            _getTime()
            .sub(beaconSpec.genesisTime)
            .div(beaconSpec.slotsPerEpoch)
            .div(beaconSpec.secondsPerSlot)
        );
    }

    /**
     * @notice Returns the first and last epochs that can be reported
     */
    function getCurrentReportableEpochs()
        public view
        returns (
            uint256 minReportableEpochId,
            uint256 maxReportableEpochId
        )
    {
        return (REPORTABLE_EPOCH_ID_POSITION.getStorageUint256(), getCurrentEpochId());
    }

    /**
     * @notice Reports beacon balance and its change
     */
    function getLastCompletedReportDelta()
        public view
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
     * @dev Sets beacon spec
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

    /**
     * @dev Returns beaconSpec struct
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
     * @dev Returns if quorum reached and mode-value report
     * @return isQuorum - true, when quorum is reached, false otherwise
     * @return modeReport - valid mode-value report when quorum is reached, 0-data otherwise
     */
    function _getQuorumReport() internal view returns (bool isQuorum, Report memory modeReport) {
        uint256 quorum = getQuorum();

        // check most frequent cases: all reports are the same or no reports yet
        if (gatheredReportKinds.length == 1) {
            return (gatheredReportKinds[0].count >= quorum, gatheredReportKinds[0].report);
        } else if (gatheredReportKinds.length == 0) {
            return (false, Report({beaconBalance: 0, beaconValidators: 0}));
        }

        // if more than 2 kind of reports exist, choose the most frequent
        uint256 maxi = 0;
        for (uint256 i = 1; i < gatheredReportKinds.length; ++i) {
            if (gatheredReportKinds[i].count > gatheredReportKinds[maxi].count) maxi = i;
        }
        for (i = 0; i < gatheredReportKinds.length; ++i) {
            if (i != maxi && gatheredReportKinds[i].count == gatheredReportKinds[maxi].count) {
                return (false, Report({beaconBalance: 0, beaconValidators: 0}));
            }
        }
        return (gatheredReportKinds[maxi].count >= quorum, gatheredReportKinds[maxi].report);
    }

    /**
     * @dev Pushes the given report to Lido and performs accompanying accounting
     */
    function _push(uint256 epochId, Report memory modeReport, BeaconSpec memory beaconSpec) internal {
        // data for this frame is collected, now this frame is completed, so
        // reportableEpochId should be changed to first epoch from the next frame
        emit Completed(epochId, modeReport.beaconBalance, modeReport.beaconValidators);
        _clearReportingAndAdvanceTo(
            epochId
            .div(beaconSpec.epochsPerFrame)
            .add(1)
            .mul(beaconSpec.epochsPerFrame));

        // report to the Lido and collect stats
        ILido lido = getLido();
        uint256 prevTotalPooledEther = ISTETH(lido).totalSupply();
        lido.pushBeacon(modeReport.beaconValidators, modeReport.beaconBalance);
        uint256 postTotalPooledEther = ISTETH(lido).totalSupply();

        PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(prevTotalPooledEther);
        POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(postTotalPooledEther);
        uint256 timeElapsed = (epochId.sub(LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256()))
            .mul(beaconSpec.slotsPerEpoch)
            .mul(beaconSpec.secondsPerSlot);
        TIME_ELAPSED_POSITION.setStorageUint256(timeElapsed);
        LAST_COMPLETED_EPOCH_ID_POSITION.setStorageUint256(epochId);

        // rollback on boundaries violation (logical consistency)
        _reportSanityChecks(postTotalPooledEther, prevTotalPooledEther, timeElapsed);

        // emit detailed statistics and call the quorum delegate with this data
        emit PostTotalShares(postTotalPooledEther, prevTotalPooledEther, timeElapsed, ISTETH(lido).getTotalShares());
        IQuorumCallback quorumCallbackAddr = IQuorumCallback(QUORUM_CALLBACK_POSITION.getStorageUint256());
        if (address(quorumCallbackAddr) != address(0)) {
            quorumCallbackAddr.processLidoOracleReport(postTotalPooledEther, prevTotalPooledEther, timeElapsed);
        }
    }

    function _clearReportingAndAdvanceTo(uint256 _epochId) internal {
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        REPORTABLE_EPOCH_ID_POSITION.setStorageUint256(_epochId);
        delete gatheredReportKinds;
        emit ReportableEpochIdUpdated(_epochId);
    }

    function reportToUint256(Report _report) internal pure returns (uint256) {
        return uint256(_report.beaconBalance) << 128 | uint256(_report.beaconValidators);
    }

    function uint256ToReport(uint256 _report) internal pure returns (Report) {
        Report memory report;
        report.beaconBalance = uint128(_report >> 128);
        report.beaconValidators = uint128(_report);
        return report;
    }


    /**
     * @dev Returns member's index in the members array or MEMBER_NOT_FOUND
     */
    function _getMemberId(address _member) internal view returns (uint256) {
        uint256 length = members.length;
        for (uint256 i = 0; i < length; ++i) {
            if (members[i] == _member) {
                return i;
            }
        }
        return MEMBER_NOT_FOUND;
    }


    /**
     * @dev Returns current timestamp
     */
    function _getTime() internal view returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }
}
