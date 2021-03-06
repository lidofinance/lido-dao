// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";

import "../interfaces/IBeaconReportReceiver.sol";
import "../interfaces/ILido.sol";
import "../interfaces/ILidoOracle.sol";

import "./ReportUtils.sol";

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
 * only to the 'expected' epoch.
 */
contract LidoOracle is ILidoOracle, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using ReportUtils for uint256;

    struct BeaconSpec {
        uint64 epochsPerFrame;
        uint64 slotsPerEpoch;
        uint64 secondsPerSlot;
        uint64 genesisTime;
    }

    /// ACL
    bytes32 constant public MANAGE_MEMBERS = keccak256("MANAGE_MEMBERS");
    bytes32 constant public MANAGE_QUORUM = keccak256("MANAGE_QUORUM");
    bytes32 constant public SET_BEACON_SPEC = keccak256("SET_BEACON_SPEC");
    bytes32 constant public SET_REPORT_BOUNDARIES = keccak256("SET_REPORT_BOUNDARIES");
    bytes32 constant public SET_BEACON_REPORT_RECEIVER = keccak256("SET_BEACON_REPORT_RECEIVER");

    /// @dev Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    /// @dev Eth1 denomination is 18 digits, while Eth2 has 9 digits. Because we work with Eth2
    /// balances and to support old interfaces expecting eth1 format, we multiply by this
    /// coefficient.
    uint128 internal constant DENOMINATION_OFFSET = 1e9;

    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

    /// @dev number of the committee members required to finalize a data point
    bytes32 internal constant QUORUM_POSITION = keccak256("lido.LidoOracle.quorum");

    /// @dev link to the Lido contract
    bytes32 internal constant LIDO_POSITION = keccak256("lido.LidoOracle.lido");

    /// @dev storage for actual beacon chain specs
    bytes32 internal constant BEACON_SPEC_POSITION = keccak256("lido.LidoOracle.beaconSpec");

    /// @dev version of the initialized contract, 0 = v1
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.LidoOracle.contractVersion");

    /// @dev epoch that we currently collect reports
    bytes32 internal constant EXPECTED_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.expectedEpochId");

    /// @dev bitmask of oracle members that pushed their reports
    bytes32 internal constant REPORTS_BITMASK_POSITION = keccak256("lido.LidoOracle.reportsBitMask");

    /// @dev historic data about 2 last completed reports and their times
    bytes32 internal constant POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        keccak256("lido.LidoOracle.postCompletedTotalPooledEther");
    bytes32 internal constant PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        keccak256("lido.LidoOracle.preCompletedTotalPooledEther");
    bytes32 internal constant LAST_COMPLETED_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.lastCompletedEpochId");
    bytes32 internal constant TIME_ELAPSED_POSITION = keccak256("lido.LidoOracle.timeElapsed");

    /// @dev receiver address to be called when the quorum is reached
    bytes32 internal constant BEACON_REPORT_RECEIVER_POSITION = keccak256("lido.LidoOracle.beaconReportReceiver");

    /**
     * @dev If we use APR as a basic reference for increase, and expected range is below 10% APR.
     * May be changed by the governance.
     */
    bytes32 internal constant ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION =
        keccak256("lido.LidoOracle.allowedBeaconBalanceAnnualRelativeIncrease");

    /**
     * @dev When slashing happens, the balance may decrease at a much faster pace. Slashing are
     * one-time events that decrease the balance a fair amount - a few percent at a time in a
     * realistic scenario. Thus, instead of sanity check for an APR, we check if the plain relative
     * decrease is within bounds.  Note that it's not annual value, its just one-jump value. May
     * be changed by the governance.
     */
    bytes32 internal constant ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION =
        keccak256("lido.LidoOracle.allowedBeaconBalanceDecrease");


    /// @dev structured storage
    address[] private members;                // slot 0: oracle committee members
    uint256[] private currentReportVariants;  // slot 1: reporting storage


    /**
     * @notice Returns the Lido contract address
     */
    function getLido() public view returns (ILido) {
        return ILido(LIDO_POSITION.getStorageAddress());
    }

    /**
     * @notice Returns the oracle parameter, the number of exectly the same reports needed to
     * finalize the epoch
     */
    function getQuorum() public view returns (uint256) {
        return QUORUM_POSITION.getStorageUint256();
    }

    function getAllowedBeaconBalanceAnnualRelativeIncrease() public view returns (uint256) {
        return ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.getStorageUint256();
    }

    function getAllowedBeaconBalanceRelativeDecrease() public view returns (uint256) {
        return ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.getStorageUint256();
    }

    function setAllowedBeaconBalanceAnnualRelativeIncrease(uint256 _value) external auth(SET_REPORT_BOUNDARIES) {
        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.setStorageUint256(_value);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_value);
    }

    function setAllowedBeaconBalanceRelativeDecrease(uint256 _value) external auth(SET_REPORT_BOUNDARIES) {
        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.setStorageUint256(_value);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_value);
    }

    /**
     * @notice Returns the receiver contract address to be called upon quorum
     */
    function getBeaconReportReceiver() external view returns (address) {
        return address(BEACON_REPORT_RECEIVER_POSITION.getStorageUint256());
    }

    /**
     * @notice Set the receiver contract address to be called upon quorum
     * @dev Specify 0 to disable this functionality
     */
    function setBeaconReportReceiver(address _addr) external auth(SET_BEACON_REPORT_RECEIVER) {
        BEACON_REPORT_RECEIVER_POSITION.setStorageUint256(uint256(_addr));
        emit BeaconReportReceiverSet(_addr);
    }

    /**
     * @notice Returns the current reporting bitmap, representing oracles who have already pushed
     * their version of report during the expected epoch
     */
    function getCurrentOraclesReportStatus() external view returns (uint256) {
        return REPORTS_BITMASK_POSITION.getStorageUint256();
    }

    /**
     * @notice Returns the current reporting array size
     */
    function getCurrentReportVariantsSize() external view returns (uint256) {
        return currentReportVariants.length;
    }

    /**
     * @notice Returns the current reporting array element with the given index
     */
    function getCurrentReportVariant(uint256 _index)
        external
        view
        returns (
            uint64 beaconBalance,
            uint32 beaconValidators,
            uint16 count
        )
    {
        return currentReportVariants[_index].decodeWithCount();
    }

    /**
     * @notice Returns epoch that can be reported by oracles
     */
    function getExpectedEpochId() external view returns (uint256) {
        return EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
    }

    /**
     * @notice Returns the current oracle member committee
     */
    function getOracleMembers() external view returns (address[]) {
        return members;
    }

    /**
     * @notice Returns the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    /**
     * @notice Returns beacon specification data
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
     * @notice Set beacon specification data
     */
    function setBeaconSpec(
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        external
        auth(SET_BEACON_SPEC)
    {
        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );
    }

    /**
     * @notice Returns the epochId calculated from current timestamp
     */
    function getCurrentEpochId() external view returns (uint256) {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        return _getCurrentEpochId(beaconSpec);
    }

    /**
     * @notice Returns all needed to oracle daemons data
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
        uint64 epochsPerFrame = beaconSpec.epochsPerFrame;
        uint64 secondsPerEpoch = beaconSpec.secondsPerSlot.mul(beaconSpec.slotsPerEpoch);

        frameEpochId = _getCurrentEpochId(beaconSpec).div(epochsPerFrame).mul(epochsPerFrame);
        frameStartTime = frameEpochId.mul(secondsPerEpoch).add(genesisTime);

        uint256 nextFrameEpochId = frameEpochId.div(epochsPerFrame).add(1).mul(epochsPerFrame);
        frameEndTime = nextFrameEpochId.mul(secondsPerEpoch).add(genesisTime).sub(1);
    }

    /**
     * @notice Reports beacon balance and its change
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
     * @notice Initialize data new to v2
     * @dev Original initialize function removed from v2 because it is invoked only once
     */
    function initialize_v2(uint256 _allowedBeaconBalanceAnnualRelativeIncrease, uint256 _allowedBeaconBalanceRelativeDecrease) external {
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "ALREADY_INITIALIZED");
        CONTRACT_VERSION_POSITION.setStorageUint256(1);
        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.setStorageUint256(_allowedBeaconBalanceAnnualRelativeIncrease);
        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.setStorageUint256(_allowedBeaconBalanceRelativeDecrease);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_allowedBeaconBalanceAnnualRelativeIncrease);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_allowedBeaconBalanceRelativeDecrease);
        emit ContractVersionSet(1);
    }

    /**
     * @notice Add `_member` to the oracle member committee
     * @param _member Address of a member to add
     */
    function addOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _getMemberId(_member), "MEMBER_EXISTS");

        members.push(_member);
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");
        emit MemberAdded(_member);
    }

    /**
     * @notice Remove `_member` from the oracle member committee
     * @param _member Address of a member to remove
     */
    function removeOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        uint256 index = _getMemberId(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 last = members.length - 1;
        if (index != last) members[index] = members[last];
        members.length--;
        emit MemberRemoved(_member);

        // delete the data for the last epoch, let remained oracles report it again
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        delete currentReportVariants;
    }

    /**
     * @notice Sets the oracle parameter, the number of exectly the same reports needed to
     * finalize the epoch
     */
    function setQuorum(uint256 _quorum) external auth(MANAGE_QUORUM) {
        require(0 != _quorum, "QUORUM_WONT_BE_MADE");
        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();
        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);

        // If the quorum value lowered, check existing reports whether it is time to push
        if (oldQuorum > _quorum) {
            (bool isQuorum, uint256 report) = _getQuorumReport(_quorum);
            if (isQuorum) {
                (uint64 beaconBalance, uint32 beaconValidators) = report.decode();
                _push(
                     EXPECTED_EPOCH_ID_POSITION.getStorageUint256(),
                     DENOMINATION_OFFSET * uint128(beaconBalance),
                     beaconValidators,
                     _getBeaconSpec()
                );
            }
        }
    }

    /**
     * @notice An oracle committee member reports data from the ETH 2.0 side
     * @param _epochId Beacon Chain epoch id
     * @param _beaconBalance Balance in wei on the ETH 2.0 side (9-digit denomination)
     * @param _beaconValidators Number of validators visible on this epoch
     */
    function reportBeacon(uint256 _epochId, uint64 _beaconBalance, uint32 _beaconValidators) external {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint256 expectedEpoch = EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
        require(_epochId >= expectedEpoch, "EPOCH_IS_TOO_OLD");
        require(
             _epochId == _getCurrentEpochId(beaconSpec) / beaconSpec.epochsPerFrame * beaconSpec.epochsPerFrame,
             "UNEXPECTED_EPOCH"
        );
        uint128 beaconBalanceEth1 = DENOMINATION_OFFSET * uint128(_beaconBalance);
        emit BeaconReported(_epochId, beaconBalanceEth1, _beaconValidators, msg.sender);

        // If reported epoch has advanced, clear the last unsuccessful reporting
        if (_epochId > expectedEpoch) _clearReportingAndAdvanceTo(_epochId);

        // Make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(msg.sender);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        require(bitMask & mask == 0, "ALREADY_SUBMITTED");
        REPORTS_BITMASK_POSITION.setStorageUint256(bitMask | mask);

        // Push this report to the matching kind
        uint256 report = ReportUtils.encode(_beaconBalance, _beaconValidators);
        uint256 quorum = getQuorum();
        uint256 i = 0;

        // so iterate on all report variants we alredy have, not more then oracle members maximum
        while (i < currentReportVariants.length && currentReportVariants[i].isDifferent(report)) ++i;
        if (i < currentReportVariants.length) {
            if (currentReportVariants[i].getCount() + 1 >= quorum) {
                _push(_epochId, beaconBalanceEth1, _beaconValidators, beaconSpec);
            } else {
                ++currentReportVariants[i];
            }
        } else {
            if (quorum == 1) {
                _push(_epochId, beaconBalanceEth1, _beaconValidators, beaconSpec);
            } else {
                currentReportVariants.push(report + 1);
            }
        }
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
     * @dev Returns whether the quorum is reached and the final report
     */
    function _getQuorumReport(uint256 _quorum) internal view returns (bool isQuorum, uint256 report) {
        // check most frequent cases first: all reports are the same or no reports yet
        if (currentReportVariants.length == 1) {
            return (currentReportVariants[0].getCount() >= _quorum, currentReportVariants[0]);
        } else if (currentReportVariants.length == 0) {
            return (false, 0);
        }

        // if more than 2 kind of reports exist, choose the most frequent
        uint256 maxind = 0;
        uint256 repeat = 0;
        uint16 maxval = 0;
        uint16 cur = 0;
        for (uint256 i = 0; i < currentReportVariants.length; ++i) {
            cur = currentReportVariants[i].getCount();
            if (cur >= maxval) {
                if (cur == maxval) {
                    ++repeat;
                } else {
                    maxind = i;
                    maxval = cur;
                    repeat = 0;
                }
            }
        }
        return (maxval >= _quorum && repeat == 0, currentReportVariants[maxind]);
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
     * @dev Pushes the given report to Lido and performs accompanying accounting
     * @param _epochId Beacon chain epoch ID
     * @param _beaconBalanceEth1 Validators balace in eth1 (18-digit denomination)
     * @param _beaconValidators Number of validators visible on this epoch
     * @param _beaconSpec current beacon specification data
     */
    function _push(
        uint256 _epochId,
        uint128 _beaconBalanceEth1,
        uint128 _beaconValidators,
        BeaconSpec memory _beaconSpec
    )
        internal
    {
        emit Completed(_epochId, _beaconBalanceEth1, _beaconValidators);

        // data for this frame is collected, now this frame is completed, so
        // expectedEpochId should be changed to first epoch from the next frame
        _clearReportingAndAdvanceTo((_epochId / _beaconSpec.epochsPerFrame + 1) * _beaconSpec.epochsPerFrame);

        // report to the Lido and collect stats
        ILido lido = getLido();
        uint256 prevTotalPooledEther = lido.totalSupply();
        // remember to convert balance to 18-digit denimination, as oracles work with 9-digit
        lido.pushBeacon(_beaconValidators, _beaconBalanceEth1);
        uint256 postTotalPooledEther = lido.totalSupply();

        PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(prevTotalPooledEther);
        POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(postTotalPooledEther);
        uint256 timeElapsed = (_epochId - LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256())
            .mul(_beaconSpec.slotsPerEpoch).mul(_beaconSpec.secondsPerSlot);
        TIME_ELAPSED_POSITION.setStorageUint256(timeElapsed);
        LAST_COMPLETED_EPOCH_ID_POSITION.setStorageUint256(_epochId);

        // rollback on boundaries violation (logical consistency)
        _reportSanityChecks(postTotalPooledEther, prevTotalPooledEther, timeElapsed);

        // emit detailed statistics and call the quorum delegate with this data
        emit PostTotalShares(postTotalPooledEther, prevTotalPooledEther, timeElapsed, lido.getTotalShares());
        IBeaconReportReceiver receiver = IBeaconReportReceiver(BEACON_REPORT_RECEIVER_POSITION.getStorageUint256());
        if (address(receiver) != address(0)) {
            receiver.processLidoOracleReport(postTotalPooledEther, prevTotalPooledEther, timeElapsed);
        }
    }

    /**
     * @notice Removes current reporting progress and advances to accept later epoch
     */
    function _clearReportingAndAdvanceTo(uint256 _epochId) internal {
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        EXPECTED_EPOCH_ID_POSITION.setStorageUint256(_epochId);
        delete currentReportVariants;
        emit ExpectedEpochIdUpdated(_epochId);
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
    function _reportSanityChecks(
        uint256 _postTotalPooledEther,
        uint256 _preTotalPooledEther,
        uint256 _timeElapsed)
        internal
        view
    {
        if (_postTotalPooledEther >= _preTotalPooledEther) {  // check profit constraint
            uint256 reward = _postTotalPooledEther - _preTotalPooledEther;
            uint256 allowedBeaconBalanceAnnualIncreasePPM =
                getAllowedBeaconBalanceAnnualRelativeIncrease().mul(_preTotalPooledEther);
            uint256 rewardAnnualizedPPM = uint256(1e6 * 365 days).mul(reward).div(_timeElapsed);
            require(rewardAnnualizedPPM <= allowedBeaconBalanceAnnualIncreasePPM, "ALLOWED_BEACON_BALANCE_INCREASE");
        } else {  // check loss constraint
            uint256 loss = _preTotalPooledEther - _postTotalPooledEther;
            uint256 allowedBeaconBalanceDecreasePPM =
                getAllowedBeaconBalanceRelativeDecrease().mul(_preTotalPooledEther);
            uint256 lossPPM = uint256(1e6).mul(loss);
            require(lossPPM <= allowedBeaconBalanceDecreasePPM, "ALLOWED_BEACON_BALANCE_DECREASE");
        }
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
     * @notice Returns the epochId calculated from current timestamp
     */
    function _getCurrentEpochId(BeaconSpec memory _beaconSpec) internal view returns (uint256) {
        return (
            _getTime()
            .sub(_beaconSpec.genesisTime)
            .div(_beaconSpec.slotsPerEpoch)
            .div(_beaconSpec.secondsPerSlot)
        );
    }

    /**
     * @dev Returns current timestamp
     */
    function _getTime() internal view returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }
}
