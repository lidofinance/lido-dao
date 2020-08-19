pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/IsContract.sol";

import "@depools/dao/contracts/interfaces/IDePoolOracle.sol";
import "@depools/dao/contracts/interfaces/IDePool.sol";

import "./Algorithm.sol";
import "./BitOps.sol";

/**
  * @title Implementation of an ETH 2.0 -> ETH oracle
  *
  * The goal of the oracle is to inform other parts of the system about balances controlled
  * by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation
  * and can go down because of slashing.
  *
  * The timeline is divided into consecutive epochs. At most one data point is produced per epoch.
  * A data point is considered finalized (produced) as soon as `quorum` oracle committee members
  * send data.
  * There can be gaps in data points if for some point `quorum` is not reached.
  * It's prohibited to add data to non-current data points whatever finalized or not.
  * It's prohibited to add data to the current finalized data point.
  */
contract DePoolOracle is IDePoolOracle, IsContract, AragonApp {
    using SafeMath for uint256;
    using BitOps for uint256;

    /// ACL
    bytes32 constant public MANAGE_MEMBERS = keccak256("MANAGE_MEMBERS");
    bytes32 constant public MANAGE_QUORUM = keccak256("MANAGE_QUORUM");
    bytes32 constant public SET_POOL = keccak256("SET_POOL");

    /// @dev Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    uint256 internal constant EPOCH_DURATION = 1 days;
    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

    /// @dev oracle committee members
    address[] private members;
    /// @dev number of the committee members required to finalize a data point
    uint256 private quorum;

    /// @dev link to the pool
    IDePool public pool;

    // data describing last finalized data point
    uint256 private lastFinalizedEpoch;
    uint256 private lastFinalizedData;

    // data of the current aggregation
    uint256 private currentlyAggregatedEpoch;
    uint256 private contributionBitMask;
    uint256[] private currentlyAggregatedData;  // only indexes set in contributionBitMask are valid


    function initialize() public onlyInit {
        assert(1 == ((1 << (MAX_MEMBERS - 1)) >> (MAX_MEMBERS - 1)));   // static assert

        initialized();
    }


    /**
      * @notice Sets the pool address to notify
      */
    function setPool(address _pool) external auth(SET_POOL) {
        require(isContract(_pool), "POOL_NOT_CONTRACT");
        pool = IDePool(_pool);
    }

    /**
      * @notice Adds a member to the oracle member committee
      * @param _member Address of a member to add
      */
    function addOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _findMember(_member), "MEMBER_EXISTS");

        members.push(_member);
        // Unitialized data is fine since contributionBitMask tells which cells to use.
        currentlyAggregatedData.length = members.length;
        assert(!contributionBitMask.getBit(members.length.sub(1)));

        if (1 == members.length) {
            quorum = 1;
        }

        emit MemberAdded(_member);
        _assertInvariants();
    }

    /**
      * @notice Removes a member from the oracle member committee
      * @param _member Address of a member to remove
      */
    function removeOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(members.length > quorum, "QUORUM_WONT_BE_MADE");

        uint256 index = _findMember(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");

        uint256 last = members.length.sub(1);
        if (index != last) {
            members[index] = members[last];
            currentlyAggregatedData[index] = currentlyAggregatedData[last];
            contributionBitMask = contributionBitMask.setBit(index, contributionBitMask.getBit(last));
        }
        contributionBitMask = contributionBitMask.setBit(last, false);
        members.length--;
        currentlyAggregatedData.length--;

        emit MemberRemoved(_member);
        _assertInvariants();
    }

    /**
      * @notice Sets the number of oracle members required to form a data point
      */
    function setQuorum(uint256 _quorum) external auth(MANAGE_QUORUM) {
        require(members.length >= _quorum && 0 != _quorum, "QUORUM_WONT_BE_MADE");

        quorum = _quorum;
        emit QuorumChanged(_quorum);

        if (currentlyAggregatedEpoch == _getCurrentEpoch())
            _tryFinalize();

        _assertInvariants();
    }


    /**
      * @notice An oracle committee member pushes data from the ETH 2.0 side
      * @param _epoch Epoch id
      * @param _eth2balance Balance in wei on the ETH 2.0 side
      */
    function pushData(uint256 _epoch, uint256 _eth2balance) external {
        require(_epoch == _getCurrentEpoch(), "EPOCH_IS_NOT_CURRENT");
        assert(lastFinalizedEpoch <= _epoch);
        require(lastFinalizedEpoch != _epoch, "ALREADY_FINALIZED");

        address member = msg.sender;
        uint256 index = _findMember(member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");

        if (currentlyAggregatedEpoch != _epoch) {
            // reset aggregation on new epoch
            currentlyAggregatedEpoch = _epoch;
            contributionBitMask = 0;
            // We don't need to waste gas resetting currentlyAggregatedData since
            // we cleared the index - contributionBitMask.
            // Moreover, it's beneficial to keep the array populated with non-zero values
            // since rewriting an existing value consumes less gas.
        }

        // check & set contribution flag
        require(!contributionBitMask.getBit(index), "ALREADY_SUBMITTED");
        contributionBitMask = contributionBitMask.setBit(index, true);

        currentlyAggregatedData[index] = _eth2balance;

        _tryFinalize();
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
      * @notice Returns epoch duration in seconds
      * @dev Epochs are consecutive time intervals. Oracle data is aggregated
      *      and processed for each epoch independently.
      */
    function getEpochDurationSeconds() external view returns (uint256) {
        return EPOCH_DURATION;
    }

    /**
      * @notice Returns epoch id for a timestamp
      * @param _timestamp Unix timestamp, seconds
      */
    function getEpochForTimestamp(uint256 _timestamp) external view returns (uint256) {
        return _getEpochForTimestamp(_timestamp);
    }

    /**
      * @notice Returns current epoch id
      */
    function getCurrentEpoch() external view returns (uint256) {
        return _getCurrentEpoch();
    }


    /**
      * @notice Returns the latest data from the ETH 2.0 side
      * @dev Depending on the oracle member committee liveness, the data can be stale. See _epoch.
      * @return _epoch Epoch id
      * @return _eth2balance Balance in wei on the ETH 2.0 side
      */
    function getLatestData() external view returns (uint256 epoch, uint256 eth2balance) {
        return (lastFinalizedEpoch, lastFinalizedData);
    }


    /**
      * @dev Finalizes the current data point if quorum is reached
      */
    function _tryFinalize() internal {
        uint256 mask = contributionBitMask;
        uint256 popcnt = mask.popcnt();
        if (popcnt < quorum)
            return;

        assert(0 != popcnt && popcnt <= members.length);

        // getting reported data out of sparse currentlyAggregatedData
        uint256[] memory data = new uint256[](popcnt);
        uint256 i = 0;

        uint256 membersLength = members.length;
        for (uint256 index = 0; index < membersLength; ++index) {
            if (mask.getBit(index)) {
                data[i++] = currentlyAggregatedData[index];
            }
        }
        assert(i == data.length);

        // computing a median on data
        lastFinalizedData = Algorithm.modifyingMedian(data);
        lastFinalizedEpoch = _getCurrentEpoch();

        emit AggregatedData(lastFinalizedEpoch, lastFinalizedData);

        if (address(0) != address(pool))
            pool.reportEther2(lastFinalizedEpoch, lastFinalizedData);
    }

    /**
      * @dev Checks code self-consistency
      */
    function _assertInvariants() private view {
        assert(quorum != 0 && members.length >= quorum);
        assert(members.length <= MAX_MEMBERS);
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
      * @dev Returns current epoch id
      */
    function _getCurrentEpoch() internal view returns (uint256) {
        return _getEpochForTimestamp(_getTime());
    }

    /**
      * @dev Returns epoch id for a timestamp
      * @param _timestamp Unix timestamp, seconds
      */
    function _getEpochForTimestamp(uint256 _timestamp) internal pure returns (uint256) {
        return _timestamp.div(EPOCH_DURATION);
    }
}
