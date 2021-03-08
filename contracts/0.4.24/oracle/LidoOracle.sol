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
 * only if no quorum is reached for this epoch yet.
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

    /// Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    /// Eth1 denomination is 18 digits, while Eth2 has 9 digits. Because we work with Eth2
    /// balances and to support old interfaces expecting eth1 format, we multiply by this
    /// coefficient.
    uint128 internal constant DENOMINATION_OFFSET = 1e9;

    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

    /// Number of exactly the same reports needed to finalize the epoch
    bytes32 internal constant QUORUM_POSITION = keccak256("lido.LidoOracle.quorum");

    /// Address of the Lido contract
    bytes32 internal constant LIDO_POSITION = keccak256("lido.LidoOracle.lido");

    /// Storage for the actual beacon chain specification
    bytes32 internal constant BEACON_SPEC_POSITION = keccak256("lido.LidoOracle.beaconSpec");

    /// Version of the initialized contract data, v1 is 0
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.LidoOracle.contractVersion");

    /// Epoch that we currently collect reports
    bytes32 internal constant EXPECTED_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.expectedEpochId");

    /// The bitmask of the oracle members that pushed their reports
    bytes32 internal constant REPORTS_BITMASK_POSITION = keccak256("lido.LidoOracle.reportsBitMask");

    /// Historic data about 2 last completed reports and their times
    bytes32 internal constant POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        keccak256("lido.LidoOracle.postCompletedTotalPooledEther");
    bytes32 internal constant PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        keccak256("lido.LidoOracle.preCompletedTotalPooledEther");
    bytes32 internal constant LAST_COMPLETED_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.lastCompletedEpochId");
    bytes32 internal constant TIME_ELAPSED_POSITION = keccak256("lido.LidoOracle.timeElapsed");

    /// Receiver address to be called when the report is pushed to Lido
    bytes32 internal constant BEACON_REPORT_RECEIVER_POSITION = keccak256("lido.LidoOracle.beaconReportReceiver");

    /// Upper bound of the reported balance possible increase in APR, controlled by the governance
    bytes32 internal constant ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION =
        keccak256("lido.LidoOracle.allowedBeaconBalanceAnnualRelativeIncrease");

    /// Lower bound of the reported balance possible decrease, controlled by the governance
    ///
    /// @notice When slashing happens, the balance may decrease at a much faster pace. Slashing are
    /// one-time events that decrease the balance a fair amount - a few percent at a time in a
    /// realistic scenario. Thus, instead of sanity check for an APR, we check if the plain relative
    /// decrease is within bounds.  Note that it's not annual value, its just one-jump value.
    bytes32 internal constant ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION =
        keccak256("lido.LidoOracle.allowedBeaconBalanceDecrease");


    /// Contract structured storage
    address[] private members;                /// slot 0: oracle committee members
    uint256[] private currentReportVariants;  /// slot 1: reporting storage


    /**
     * Returns the Lido contract address
     */
    function getLido() public view returns (ILido) {
        return ILido(LIDO_POSITION.getStorageAddress());
    }

    /**
     * Returns the number of erectly the same reports needed to finalize the epoch
     */
    function getQuorum() public view returns (uint256) {
        return QUORUM_POSITION.getStorageUint256();
    }

    /**
     * Returns the upper bound of the reported balance possible increase in APR
     */
    function getAllowedBeaconBalanceAnnualRelativeIncrease() public view returns (uint256) {
        return ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.getStorageUint256();
    }

    /**
     * Returns the lower bound of the reported balance possible decrease
     */
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
     * Returns the receiver contract address to be called when the report is pushed to Lido
     */
    function getBeaconReportReceiver() external view returns (address) {
        return address(BEACON_REPORT_RECEIVER_POSITION.getStorageUint256());
    }

    /**
     * Set the receiver contract address to be called when the report is pushed to Lido
     * @dev Specify 0 to disable this functionality
     */
    function setBeaconReportReceiver(address _addr) external auth(SET_BEACON_REPORT_RECEIVER) {
        BEACON_REPORT_RECEIVER_POSITION.setStorageUint256(uint256(_addr));
        emit BeaconReportReceiverSet(_addr);
    }

    /**
     * Returns the current reporting bitmap, representing oracles who have already pushed their
     * version of report during the expected epoch
     */
    function getCurrentOraclesReportStatus() external view returns (uint256) {
        return REPORTS_BITMASK_POSITION.getStorageUint256();
    }

    /**
     * Returns the current reporting array size
     */
    function getCurrentReportVariantsSize() external view returns (uint256) {
        return currentReportVariants.length;
    }

    /**
     * Returns the current reporting array element with the given index
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
     * Returns epoch that can be reported by oracles
     */
    function getExpectedEpochId() external view returns (uint256) {
        return EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
    }

    /**
     * Returns the current oracle member committee list
     */
    function getOracleMembers() external view returns (address[]) {
        return members;
    }

    /**
     * Returns the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    /**
     * Returns beacon specification data
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
     * Sets beacon specification data
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
     * Returns the epoch calculated from current timestamp
     */
    function getCurrentEpochId() external view returns (uint256) {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        return _getCurrentEpochId(beaconSpec);
    }

    /**
     * Returns all needed to oracle daemons data
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
        uint64 secondsPerEpoch = beaconSpec.secondsPerSlot.mul(beaconSpec.slotsPerEpoch);

        frameEpochId = _getCurrentFrameFirstEpochId(beaconSpec);
        frameStartTime = frameEpochId.mul(secondsPerEpoch).add(genesisTime);
        frameEndTime = (frameEpochId + beaconSpec.epochsPerFrame).mul(secondsPerEpoch).add(genesisTime).sub(1);
    }

    /**
     * Reports beacon balance and its change
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
     * Initialize contract data, that is new to v2
     * @dev Original initialize function removed from v2 because it is invoked only once
     */
    function initialize_v2(
        uint256 _allowedBeaconBalanceAnnualRelativeIncrease,
        uint256 _allowedBeaconBalanceRelativeDecrease
    )
        external
    {
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "ALREADY_INITIALIZED");
        CONTRACT_VERSION_POSITION.setStorageUint256(1);
        emit ContractVersionSet(1);

        uint256 expectedEpoch = _getCurrentFrameFirstEpochId(_getBeaconSpec());
        EXPECTED_EPOCH_ID_POSITION.setStorageUint256(expectedEpoch);
        emit ExpectedEpochIdUpdated(expectedEpoch);

        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceAnnualRelativeIncrease);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_allowedBeaconBalanceAnnualRelativeIncrease);

        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceRelativeDecrease);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_allowedBeaconBalanceRelativeDecrease);
    }

    /**
     * Adds the given address to the oracle member committee list
     */
    function addOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _getMemberId(_member), "MEMBER_EXISTS");

        members.push(_member);
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");
        emit MemberAdded(_member);
    }

    /**
     * Removes the given address from the oracle member committee list
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
     * Sets the number of exactly the same reports needed to finalize the epoch
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
     * Accepts oracle committee member reports from the ETH 2.0 side
     * @param _epochId Beacon chain epoch
     * @param _beaconBalance Balance in wei on the ETH 2.0 side (9-digit denomination)
     * @param _beaconValidators Number of validators visible in this epoch
     */
    function reportBeacon(uint256 _epochId, uint64 _beaconBalance, uint32 _beaconValidators) external {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint256 expectedEpoch = EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
        require(_epochId >= expectedEpoch, "EPOCH_IS_TOO_OLD");

        // if expected epoch has advanced, check that this is the first epoch of the current frame
        // and clear the last unsuccessful reporting
        if (_epochId > expectedEpoch) {
            require(_epochId == _getCurrentFrameFirstEpochId(beaconSpec), "UNEXPECTED_EPOCH");
            _clearReportingAndAdvanceTo(_epochId);
        }
        
        uint128 beaconBalanceEth1 = DENOMINATION_OFFSET * uint128(_beaconBalance);
        emit BeaconReported(_epochId, beaconBalanceEth1, _beaconValidators, msg.sender);

        // make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(msg.sender);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        require(bitMask & mask == 0, "ALREADY_SUBMITTED");
        REPORTS_BITMASK_POSITION.setStorageUint256(bitMask | mask);

        // push this report to the matching kind
        uint256 report = ReportUtils.encode(_beaconBalance, _beaconValidators);
        uint256 quorum = getQuorum();
        uint256 i = 0;

        // iterate on all report variants we already have, limited by the oracle members maximum
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
     * Returns BeaconSpec structure
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
     * Returns whether the quorum is reached and the final report
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
     * Sets beacon specification data
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
     * Pushes the given report to Lido and performs accompanying accounting
     * @param _epochId Beacon chain epoch, proven to be >= expected epoch and <= current epoch
     * @param _beaconBalanceEth1 Validators balance in eth1 (18-digit denomination)
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

        // now this frame is completed, so the expected epoch should be advanced to the first epoch
        // of the next frame
        _clearReportingAndAdvanceTo((_epochId / _beaconSpec.epochsPerFrame + 1) * _beaconSpec.epochsPerFrame);

        // report to the Lido and collect stats
        ILido lido = getLido();
        uint256 prevTotalPooledEther = lido.totalSupply();
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
     * Removes the current reporting progress and advances to accept later epoch
     */
    function _clearReportingAndAdvanceTo(uint256 _epochId) internal {
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        EXPECTED_EPOCH_ID_POSITION.setStorageUint256(_epochId);
        delete currentReportVariants;
        emit ExpectedEpochIdUpdated(_epochId);
    }

    /**
     * To make oracles less dangerous, we can limit rewards report by 0.1% increase in stake and 
     * 15% decrease in stake, with both values configurable by the governance in case of extremely
     * unusual circumstances.
     *
     * daily_reward_rate_PPM = 1e6 * reward / totalPooledEther / days
     *
     * Note, if you deploy the fresh contract (e.g. on testnet) it may fail at the beginning of the
     * work because the initial pooledEther may be small and it's allowed tiny in absolute numbers,
     * but significant in relative numbers. E.g. if the initial balance is as small as 1e12 and then
     * it raises to 2 * 1e12, in relative numbers, it will be a 100% increase, so just relax
     * boundaries in such case. This problem should never occur in real-world application because
     * the previous contract version is already working and huge balances are already collected.
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
     * Returns member's index in the members list or MEMBER_NOT_FOUND
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
     * Returns the epoch calculated from current timestamp
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
     * Returns the first epoch of the current frame
     */
    function _getCurrentFrameFirstEpochId(BeaconSpec memory _beaconSpec) internal view returns (uint256) {
        return _getCurrentEpochId(_beaconSpec) / _beaconSpec.epochsPerFrame * _beaconSpec.epochsPerFrame;
    }

    /**
     * Returns the current timestamp
     */
    function _getTime() internal view returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }
}
