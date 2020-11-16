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

    /// ACL
    bytes32 constant public MANAGE_MEMBERS = keccak256("MANAGE_MEMBERS");
    bytes32 constant public MANAGE_QUORUM = keccak256("MANAGE_QUORUM");
    bytes32 constant public SET_POOL = keccak256("SET_POOL");

    /// @dev Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

    /// @dev oracle committee members
    address[] private members;
    /// @dev number of the committee members required to finalize a data point
    uint256 private quorum;

    /// @dev link to the pool
    ILido public pool;

    uint256 public lastReportedEpoch;
    uint256 public earliestReportableEpoch;

    struct BeaconSpec {
        uint64 slotsPerEpoch;
        uint64 secondsPerSlot;
        uint64 genesisTime;
    }

    BeaconSpec public beaconSpec;

    struct Report {
        uint128 beaconBalance;
        uint128 beaconValidators;
    }

    struct EpochData {
        uint256 reportsBitMask;
        mapping (uint256 => Report) reports;
    }

    mapping(uint256 => EpochData) public gatheredEpochData;

    event Completed(
        uint256 epochId,
        uint128 beaconBalance,
        uint128 beaconValidators
    );

    event Pushed(
        uint256 epochId,
        uint128 beaconBalance,
        uint128 beaconValidators
    );

    function setBeaconSpec(uint64 slotsPerEpoch, uint64 secondsPerSlot, uint64 genesisTime) public {
        beaconSpec.slotsPerEpoch = slotsPerEpoch;
        beaconSpec.secondsPerSlot = secondsPerSlot;
        beaconSpec.genesisTime = genesisTime;
    }

    function getCurrentEpochId() public view returns (uint256) {
        return (_getTime() - beaconSpec.genesisTime) / (beaconSpec.slotsPerEpoch * beaconSpec.secondsPerSlot);
    }

    function getCurrentReportableEpochs() public view returns (uint256 firstReportableEpoch, uint256 lastReportableEpoch) {
        return (earliestReportableEpoch, getCurrentEpochId());
    }

    function getCurrentReportableTimeInterval() public view returns (uint256 startTime, uint256 endTime) {
        uint64 genesisTime = beaconSpec.genesisTime;
        uint64 secondsPerEpoch = beaconSpec.secondsPerSlot.mul(beaconSpec.slotsPerEpoch);
        startTime = earliestReportableEpoch.mul(secondsPerEpoch).add(genesisTime);
        endTime = getCurrentEpochId().add(1).mul(secondsPerEpoch).sub(1).add(genesisTime);
        return (startTime, endTime);
    }

    function initialize(ILido _lido) public onlyInit {
        assert(1 == ((1 << (MAX_MEMBERS - 1)) >> (MAX_MEMBERS - 1)));  // static assert
        pool = _lido;
        initialized();
    }

    /**
      * @notice Add `_member` to the oracle member committee
      * @param _member Address of a member to add
      */
    function addOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _findMember(_member), "MEMBER_EXISTS");

        members.push(_member);

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

        uint256 index = _findMember(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");

        earliestReportableEpoch = lastReportedEpoch;
        uint256 last = members.length.sub(1);

        uint256 bitMask = gatheredEpochData[lastReportedEpoch].reportsBitMask;
        if (index != last) {
            members[index] = members[last];
            bitMask = bitMask.setBit(index, bitMask.getBit(last));
        }
        bitMask = bitMask.setBit(last, false);
        gatheredEpochData[lastReportedEpoch].reportsBitMask = bitMask;

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

        assert(lastReportedEpoch <= getCurrentEpochId());

        if (lastReportedEpoch > earliestReportableEpoch) {
            earliestReportableEpoch = lastReportedEpoch;
            _tryPush(lastReportedEpoch);
        }

        _assertInvariants();
    }

    /**
     * @notice An oracle committee member reports data from the ETH 2.0 side
     * @param _epochId BeaconChain epoch id
     * @param _eth2balance Balance in wei on the ETH 2.0 side
     * @param _validators Number of validators visible on this epoch
     */
    function reportBeacon(uint256 _epochId, uint128 _eth2balance, uint128 _validators) external {
        (uint256 startEpoch, uint256 endEpoch) = getCurrentReportableEpochs();
        require(_epochId >= startEpoch, "EPOCH_IS_TOO_OLD");
        require(_epochId <= endEpoch, "EPOCH_HAS_NOT_YET_BEGUN");

        address member = msg.sender;
        uint256 index = _findMember(member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");

        // check & set contribution flag
        uint256 bitMask = gatheredEpochData[_epochId].reportsBitMask;
        require(!bitMask.getBit(index), "ALREADY_SUBMITTED");

        lastReportedEpoch = _epochId;

        gatheredEpochData[_epochId].reportsBitMask = bitMask.setBit(index, true);

        Report memory currentReport = Report(_eth2balance, _validators);
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

        // data for this epoch are collected, now this epoch is completed and can not be reported anymore
        earliestReportableEpoch = _epochId.add(1);

        // unpack Report struct from uint256
        Report memory modeReport = uint256ToReport(mode);

        emit Completed(_epochId, modeReport.beaconBalance, modeReport.beaconValidators);

        if (address(0) != address(pool))
        {
            pool.pushBeacon(modeReport.beaconValidators, modeReport.beaconBalance);
            emit Pushed(_epochId, modeReport.beaconBalance, modeReport.beaconValidators);
        }
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
    function _findMember(address _member) internal view returns (uint256) {
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
