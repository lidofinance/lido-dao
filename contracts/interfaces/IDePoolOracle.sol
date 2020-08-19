pragma solidity 0.4.24;


/**
  * @title ETH 2.0 -> ETH oracle
  *
  * The goal of the oracle is to inform other parts of the system about balances controlled
  * by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation
  * and can go down because of slashing.
  */
interface IDePoolOracle {
    /**
      * @notice Adds a member to the oracle member committee
      * @param _member Address of a member to add
      */
    function addOracleMember(address _member) external;

    /**
      * @notice Removes a member from the oracle member committee
      * @param _member Address of a member to remove
      */
    function removeOracleMember(address _member) external;

    /**
      * @notice Returns the current oracle member committee
      */
    function getOracleMembers() external view returns (address[]);

    /**
      * @notice Sets the number of oracle members required to form a data point
      */
    function setQuorum(uint256 _quorum) external;

    /**
      * @notice Returns the number of oracle members required to form a data point
      */
    function getQuorum() external view returns (uint256);

    event MemberAdded(address member);
    event MemberRemoved(address member);
    event QuorumChanged(uint256 quorum);


    /**
      * @notice Returns epoch duration in seconds
      * @dev Epochs are consecutive time intervals. Oracle data is aggregated
      *      and processed for each epoch independently.
      */
    function getEpochDurationSeconds() external view returns (uint256);

    /**
      * @notice Returns epoch id for a timestamp
      * @param _timestamp Unix timestamp, seconds
      */
    function getEpochForTimestamp(uint256 _timestamp) external view returns (uint256);

    /**
      * @notice Returns current epoch id
      */
    function getCurrentEpoch() external view returns (uint256);

    /**
      * @notice An oracle committee member pushes data from the ETH 2.0 side
      * @param _epoch Epoch id
      * @param _eth2balance Balance in wei on the ETH 2.0 side
      */
    function pushData(uint256 _epoch, uint256 _eth2balance) external;

    /**
      * @notice Returns the latest data from the ETH 2.0 side
      * @dev Depending on the oracle member committee liveness, the data can be stale. See _epoch.
      * @return _epoch Epoch id
      * @return _eth2balance Balance in wei on the ETH 2.0 side
      */
    function getLatestData() external view returns (uint256 epoch, uint256 eth2balance);

    // Fired when some _epoch reached quorum, was processed and yielded median _eth2balance
    event AggregatedData(uint256 epoch, uint256 eth2balance);
}
