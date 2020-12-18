// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";

import "../interfaces/ILidoOracle.sol";
import "../interfaces/ILido.sol";

import "./BitOps.sol";


/**
  * @title Implementation of an ETH 2.0 -> ETH oracle
  *
  * The goal of the oracle is to inform other parts of the system about balances controlled
  * by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation
  * and can go down because of slashing.
  *
  * The timeline is divided into consecutive reportIntervals. At most one data point is produced per reportInterval.
  * A data point is considered finalized (produced) as soon as `quorum` oracle committee members
  * send data.
  * There can be gaps in data points if for some point `quorum` is not reached.
  * It's prohibited to add data to non-current data points whatever finalized or not.
  * It's prohibited to add data to the current finalized data point.
  */
contract LidoOracle is ILidoOracle, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using BitOps for uint256;

    struct BeaconSpec {
        uint64 epochsPerFrame;
        uint64 slotsPerEpoch;
        uint64 secondsPerSlot;
        uint64 genesisTime;
    }

    struct EpochData {
        uint256 reportBitMask;
        uint256[] reportValues;
        mapping (uint256 => uint256) reportValuesCount;
    }

    /// ACL
    bytes32 constant public MANAGE_MEMBERS = keccak256("MANAGE_MEMBERS");
    bytes32 constant public MANAGE_QUORUM = keccak256("MANAGE_QUORUM");
    bytes32 constant public SET_BEACON_SPEC = keccak256("SET_BEACON_SPEC");

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

    /// @dev the most early epoch that can be reported
    bytes32 internal constant MIN_REPORTABLE_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.minReportableEpochId");
    /// @dev the last reported epoch
    bytes32 internal constant LAST_REPORTED_EPOCH_ID_POSITION = keccak256("lido.LidoOracle.lastReportedEpochId");
    /// @dev storage for all gathered from reports data
    mapping(uint256 => EpochData) private gatheredEpochData;

    event Completed(
        uint256 epochId,
        uint128 beaconBalance,
        uint128 beaconValidators
    );

    function initialize(
        address _lido,
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        public onlyInit
    {
        assert(1 == ((1 << (MAX_MEMBERS - 1)) >> (MAX_MEMBERS - 1)));  // static assert

        require(_epochsPerFrame > 0, "BAD_EPOCHS_PER_FRAME");
        require(_slotsPerEpoch > 0, "BAD_SLOTS_PER_EPOCH");
        require(_secondsPerSlot > 0, "BAD_SECONDS_PER_SLOT");
        require(_genesisTime > 0, "BAD_GENESIS_TIME");

        LIDO_POSITION.setStorageAddress(_lido);

        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );

        initialized();
    }

    /**
      * @notice Add `_member` to the oracle member committee
      * @param _member Address of a member to add
      */
    function addOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _getMemberId(_member), "MEMBER_EXISTS");

        members.push(_member);

        // set quorum to 1 when first member added
        if (1 == members.length) {
            QUORUM_POSITION.setStorageUint256(1);
        }

        emit MemberAdded(_member);
        _assertInvariants();
    }

    /**
     * @notice Remove `_member` from the oracle member committee
     * @param _member Address of a member to remove
     */
    function removeOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(members.length > getQuorum(), "QUORUM_WONT_BE_MADE");

        uint256 index = _getMemberId(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");

        uint256 lastReportedEpochId = LAST_REPORTED_EPOCH_ID_POSITION.getStorageUint256();
        MIN_REPORTABLE_EPOCH_ID_POSITION.setStorageUint256(lastReportedEpochId.add(1));
        
        uint256 last = members.length.sub(1);
        if (index != last) {
            members[index] = members[last];    
        }   
        members.length--;

        emit MemberRemoved(_member);
        _assertInvariants();
    }

    /**
     * @notice Set the number of oracle members required to form a data point to `_quorum`
     */
    function setQuorum(uint256 _quorum) external auth(MANAGE_QUORUM) {
        require(members.length >= _quorum && 0 != _quorum, "QUORUM_WONT_BE_MADE");

        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);

        uint256 minReportableEpochId = (
            MIN_REPORTABLE_EPOCH_ID_POSITION.getStorageUint256()
        );
        uint256 lastReportedEpochId = (
            LAST_REPORTED_EPOCH_ID_POSITION.getStorageUint256()
        );

        assert(lastReportedEpochId <= getCurrentEpochId());

        if (lastReportedEpochId > minReportableEpochId) {
            minReportableEpochId = lastReportedEpochId;
            _tryPush(lastReportedEpochId);
        }

        _assertInvariants();
    }

    /**
     * @notice An oracle committee member reports data from the ETH 2.0 side
     * @param _epochId BeaconChain epoch id
     * @param _beaconBalance Balance in wei on the ETH 2.0 side
     * @param _beaconValidators Number of validators visible on this epoch
     */
    function reportBeacon(uint256 _epochId, uint128 _beaconBalance, uint128 _beaconValidators) external {
        (uint256 startEpoch, uint256 endEpoch) = getCurrentReportableEpochs();
        require(_epochId >= startEpoch, "EPOCH_IS_TOO_OLD");
        require(_epochId <= endEpoch, "EPOCH_HAS_NOT_YET_BEGUN");

        address member = msg.sender;
        uint256 index = _getMemberId(member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");

        // check & set contribution flag
        uint256 bitMask = gatheredEpochData[_epochId].reportBitMask;
        require(!bitMask.getBit(index), "ALREADY_SUBMITTED");

        if (_epochId > LAST_REPORTED_EPOCH_ID_POSITION.getStorageUint256())
            LAST_REPORTED_EPOCH_ID_POSITION.setStorageUint256(_epochId);

        gatheredEpochData[_epochId].reportBitMask = bitMask.setBit(index, true);

        uint256 currentReportValue = _packReportToUint256(_beaconBalance, _beaconValidators);
        uint256 currentReportValueCount = gatheredEpochData[_epochId].reportValuesCount[currentReportValue];
        if (currentReportValueCount == 0)
            gatheredEpochData[_epochId].reportValues.push(currentReportValue);
        gatheredEpochData[_epochId].reportValuesCount[currentReportValue] = currentReportValueCount.add(1);

        _tryPush(_epochId);
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

    function getGatheredEpochData(uint256 _epochId)
        external view returns (
            uint256 reportBitMask,
            uint256[] reportBalanceValues,
            uint256[] reportValidatorsValues,
            uint256[] reportValuesCount
        )
    {
        reportBitMask = gatheredEpochData[_epochId].reportBitMask;
        uint256 reportValuesLength = gatheredEpochData[_epochId].reportValues.length;
        reportBalanceValues = new uint256[](reportValuesLength);
        reportValidatorsValues = new uint256[](reportValuesLength);
        reportValuesCount = new uint256[](reportValuesLength);
        uint256 reportValue;
        for (uint256 i = 0; i < reportValuesLength; i++) {
            reportValue = gatheredEpochData[_epochId].reportValues[i];
            (reportBalanceValues[i], reportValidatorsValues[i]) = _unpackReportFromUint256(reportValue);
            reportValuesCount[i] = gatheredEpochData[_epochId].reportValuesCount[reportValue];
        }
        return (reportBitMask, reportBalanceValues, reportValidatorsValues, reportValuesCount);
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
        require(_epochsPerFrame > 0, "BAD_EPOCHS_PER_FRAME");
        require(_slotsPerEpoch > 0, "BAD_SLOTS_PER_EPOCH");
        require(_secondsPerSlot > 0, "BAD_SECONDS_PER_SLOT");
        require(_genesisTime > 0, "BAD_GENESIS_TIME");

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
     * @notice Returns the fisrt and last epochs that can be reported
     */
    function getCurrentReportableEpochs()
        public view
        returns (
            uint256 minReportableEpochId,
            uint256 maxReportableEpochId
        )
    {
        minReportableEpochId = (
            MIN_REPORTABLE_EPOCH_ID_POSITION.getStorageUint256()
        );
        return (minReportableEpochId, getCurrentEpochId());
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
        uint256 data = (
            uint256(_epochsPerFrame) << 192 |
            uint256(_slotsPerEpoch) << 128 |
            uint256(_secondsPerSlot) << 64 |
            uint256(_genesisTime)
        );
        BEACON_SPEC_POSITION.setStorageUint256(data);
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
    function _getQuorumReport(uint256 _epochId) internal view returns (bool isQuorum, uint256 modeReport) {
        uint256 mask = gatheredEpochData[_epochId].reportBitMask;
        uint256 popcnt = mask.popcnt();
        if (popcnt < getQuorum())
            return (false, 0);

        assert(0 != popcnt && popcnt <= members.length);

        uint256 reportValuesLength = gatheredEpochData[_epochId].reportValues.length;

        if (reportValuesLength == 1) {
            return (true, gatheredEpochData[_epochId].reportValues[0]);
        }
        
        uint256[] memory reportValuesCount = new uint256[](reportValuesLength);
        uint256 tmpReport;
        uint256 modeReportCountIndex;
        uint256 reportValuesCountMax;
        
        // find mode value
        for (uint256 i = 0; i < reportValuesLength; i++) {
            tmpReport = gatheredEpochData[_epochId].reportValues[i];
            reportValuesCount[i] = gatheredEpochData[_epochId].reportValuesCount[tmpReport];
            if (reportValuesCount[i] > reportValuesCountMax) {
                reportValuesCountMax = reportValuesCount[i];
                modeReport = tmpReport;
                modeReportCountIndex = i;
            }
        }
        
        assert(modeReportCountIndex < reportValuesLength);

        // check if data is unimodal
        for (i = 0; i < reportValuesLength; i++) {
            if ((i != modeReportCountIndex) && (reportValuesCount[i] == reportValuesCountMax)) {
                return (false, 0);
            }
        }

        return (true, modeReport);
    }

    /**
     * @dev Pushes the current data point if quorum is reached
     */
    function _tryPush(uint256 _epochId) internal {
        (bool isQuorum, uint256 modeReport) = _getQuorumReport(_epochId);
        if (!isQuorum)
            return;

        // data for this frame is collected, now this frame is completed, so
        // minReportableEpochId should be changed to first epoch from next frame
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        MIN_REPORTABLE_EPOCH_ID_POSITION.setStorageUint256(
            _epochId
            .div(beaconSpec.epochsPerFrame)
            .add(1)
            .mul(beaconSpec.epochsPerFrame)
        );

        (uint128 beaconBalance, uint128 beaconValidators) = _unpackReportFromUint256(modeReport);
        emit Completed(_epochId, beaconBalance, beaconValidators);

        ILido lido = getLido();
        if (address(0) != address(lido))
            lido.pushBeacon(beaconValidators, beaconBalance);
    }

    function _packReportToUint256(uint128 _beaconBalance, uint128 _beaconValidators) internal pure returns (uint256) {
        return uint256(_beaconBalance) << 128 | uint256(_beaconValidators);
    }

    function _unpackReportFromUint256(uint256 _report) internal pure returns (uint128, uint128) {
        uint128 beaconBalance = uint128(_report >> 128);
        uint128 beaconValidators = uint128(_report);
        return (beaconBalance, beaconValidators);
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
        return block.timestamp;
    }

    /**
     * @dev Checks code self-consistency
     */
    function _assertInvariants() private view {
        uint256 quorum = getQuorum();
        assert(quorum != 0 && members.length >= quorum);
        assert(members.length <= MAX_MEMBERS);
    }
}
