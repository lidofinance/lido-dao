/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "@aragon/os/contracts/common/IsContract.sol";

import "../interfaces/ILidoOracle.sol";
import "../interfaces/ILido.sol";

import "./Algorithm.sol";
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
contract LidoOracle is ILidoOracle, IsContract, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using BitOps for uint256;

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

    struct EpochData {
        uint256 reportsBitMask;
        mapping (uint256 => Report) reports;
    }

    /// ACL
    bytes32 constant public MANAGE_MEMBERS = keccak256("MANAGE_MEMBERS");
    bytes32 constant public MANAGE_QUORUM = keccak256("MANAGE_QUORUM");
    bytes32 constant public SET_POOL = keccak256("SET_POOL");
    bytes32 constant public SET_BEACON_SPEC = keccak256("SET_BEACON_SPEC");

    /// @dev Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

    /// @dev oracle committee members
    address[] private members;
    /// @dev number of the committee members required to finalize a data point
    uint256 private quorum;

    /// @dev link to the pool
    ILido public pool;

    /// @dev struct for actual beacon chain specs
    BeaconSpec public beaconSpec;

    /// @dev the most early epoch that can be reported
    uint256 public earliestReportableEpochId;
    /// @dev the last reported epoch
    uint256 private lastReportedEpochId;
    /// @dev storage for all gathered from reports data
    mapping(uint256 => EpochData) private gatheredEpochData;

    event Completed(
        uint256 epochId,
        uint128 beaconBalance,
        uint128 beaconValidators
    );

    function initialize(
        ILido _lido,
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        public onlyInit
    {
        assert(1 == ((1 << (MAX_MEMBERS - 1)) >> (MAX_MEMBERS - 1)));  // static assert

        require(_epochsPerFrame > 0);
        require(_slotsPerEpoch > 0);
        require(_secondsPerSlot > 0);
        require(_genesisTime > 0);

        pool = _lido;

        beaconSpec.epochsPerFrame = _epochsPerFrame;
        beaconSpec.slotsPerEpoch = _slotsPerEpoch;
        beaconSpec.secondsPerSlot = _secondsPerSlot;
        beaconSpec.genesisTime = _genesisTime;

        initialized();
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
        external auth(SET_BEACON_SPEC)
    {
        require(_epochsPerFrame > 0);
        require(_slotsPerEpoch > 0);
        require(_secondsPerSlot > 0);
        require(_genesisTime > 0);

        beaconSpec.epochsPerFrame = _epochsPerFrame;
        beaconSpec.slotsPerEpoch = _slotsPerEpoch;
        beaconSpec.secondsPerSlot = _secondsPerSlot;
        beaconSpec.genesisTime = _genesisTime;
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
            quorum = 1;
        }

        emit MemberAdded(_member);
        _assertInvariants();
    }

    /**
     * @notice Remove `_member` from the oracle member committee
     * @param _member Address of a member to remove
     */
    function removeOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(members.length > quorum, "QUORUM_WONT_BE_MADE");

        uint256 index = _getMemberId(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");

        earliestReportableEpochId = lastReportedEpochId;
        uint256 last = members.length.sub(1);

        uint256 bitMask = gatheredEpochData[lastReportedEpochId].reportsBitMask;
        if (index != last) {
            members[index] = members[last];
            bitMask = bitMask.setBit(index, bitMask.getBit(last));
        }
        bitMask = bitMask.setBit(last, false);
        gatheredEpochData[lastReportedEpochId].reportsBitMask = bitMask;

        members.length--;

        emit MemberRemoved(_member);
        _assertInvariants();
    }

    /**
     * @notice Set the number of oracle members required to form a data point to `_quorum`
     */
    function setQuorum(uint256 _quorum) external auth(MANAGE_QUORUM) {
        require(members.length >= _quorum && 0 != _quorum, "QUORUM_WONT_BE_MADE");

        quorum = _quorum;
        emit QuorumChanged(_quorum);

        assert(lastReportedEpochId <= getCurrentEpochId());

        if (lastReportedEpochId > earliestReportableEpochId) {
            earliestReportableEpochId = lastReportedEpochId;
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
        uint256 bitMask = gatheredEpochData[_epochId].reportsBitMask;
        require(!bitMask.getBit(index), "ALREADY_SUBMITTED");

        lastReportedEpochId = _epochId;

        gatheredEpochData[_epochId].reportsBitMask = bitMask.setBit(index, true);

        Report memory currentReport = Report(_beaconBalance, _beaconValidators);
        gatheredEpochData[_epochId].reports[index] = currentReport;

        _tryPush(_epochId);
    }

    /**
     * @notice Returns the current oracle member committee
     */
    function getOracleMembers() external view returns (address[]) {
        return members;
    }

    /**
     * @notice Returns the number of oracle members required to form a data point
     */
    function getQuorum() external view returns (uint256) {
        return quorum;
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
        uint64 genesisTime = beaconSpec.genesisTime;
        uint64 epochsPerFrame = beaconSpec.epochsPerFrame;
        uint64 secondsPerEpoch = beaconSpec.secondsPerSlot.mul(beaconSpec.slotsPerEpoch);

        frameEpochId = getCurrentEpochId().div(epochsPerFrame).mul(epochsPerFrame);
        frameStartTime = frameEpochId.mul(secondsPerEpoch).add(genesisTime);

        uint256 nextFrameEpochId = frameEpochId.div(epochsPerFrame).add(1).mul(epochsPerFrame);
        frameEndTime = nextFrameEpochId.mul(secondsPerEpoch).add(genesisTime).sub(1);
    }

    /**
     * @notice Returns the epochId calculated from current timestamp
     */
    function getCurrentEpochId() public view returns (uint256) {
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
            uint256 firstReportableEpochId,
            uint256 lastReportableEpochId
        )
    {
        return (earliestReportableEpochId, getCurrentEpochId());
    }

    /**
     * @dev Pushed the current data point if quorum is reached
     */
    function _tryPush(uint256 _epochId) internal {
        uint256 mask = gatheredEpochData[_epochId].reportsBitMask;
        uint256 popcnt = mask.popcnt();
        if (popcnt < quorum)
            return;

        assert(0 != popcnt && popcnt <= members.length);

        // pack current gatheredEpochData mapping to uint256 array
        uint256[] memory data = new uint256[](popcnt);
        uint256 i = 0;
        uint256 membersLength = members.length;
        for (uint256 index = 0; index < membersLength; ++index) {
            if (mask.getBit(index)) {
                data[i++] = reportToUint256(gatheredEpochData[_epochId].reports[index]);
            }
        }

        assert(i == data.length);

        // find mode value of this array
        (bool isUnimodal, uint256 mode) = Algorithm.mode(data);
        if (!isUnimodal)
            return;

        // unpack Report struct from uint256
        Report memory modeReport = uint256ToReport(mode);

        // data for this frame is collected, now this frame is completed, so
        // earliestReportableEpochId should be changed to first epoch from next frame
        earliestReportableEpochId = (
            _epochId
            .div(beaconSpec.epochsPerFrame)
            .add(1)
            .mul(beaconSpec.epochsPerFrame)
        );

        emit Completed(_epochId, modeReport.beaconBalance, modeReport.beaconValidators);

        if (address(0) != address(pool))
            pool.pushBeacon(modeReport.beaconValidators, modeReport.beaconBalance);
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
        return block.timestamp;
    }

    /**
     * @dev Checks code self-consistency
     */
    function _assertInvariants() private view {
        assert(quorum != 0 && members.length >= quorum);
        assert(members.length <= MAX_MEMBERS);
    }
}
