pragma solidity 0.4.24;


/**
  * @title ETH 2.0 -> ETH oracle
  *
  * The goal of the oracle is to inform other parts of the system about balances controlled
  * by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation
  * and can go down because of slashing.
  */
interface ILidoOracle {
    /**
      * @notice Add `_member` to the oracle member committee
      * @param _member Address of a member to add
      */
    function addOracleMember(address _member) external;

    /**
      * @notice Remove `_member` from the oracle member committee
      * @param _member Address of a member to remove
      */
    function removeOracleMember(address _member) external;

    /**
      * @notice Returns the current oracle member committee
      */
    function getOracleMembers() external view returns (address[]);

    /**
      * @notice Set the number of oracle members required to form a data point to `_quorum`
      */
    function setQuorum(uint256 _quorum) external;

    /**
      * @notice Set the new report interval duration to `_reportIntervalDuration`
      */
    function setReportIntervalDuration(uint256 _reportIntervalDuration) external;

    /**
      * @notice Returns the number of oracle members required to form a data point
      */
    function getQuorum() external view returns (uint256);

    event MemberAdded(address member);
    event MemberRemoved(address member);
    event QuorumChanged(uint256 quorum);
    event ReportIntervalDurationChanged(uint256 duration);


    /**
      * @notice Returns reportInterval duration in seconds
      * @dev ReportIntervals are consecutive time intervals. Oracle data is aggregated
      *      and processed for each reportInterval independently.
      */
    function getReportIntervalDurationSeconds() external view returns (uint256);

    /**
      * @notice Returns reportInterval id for a timestamp
      * @param _timestamp Unix timestamp, seconds
      */
    function getReportIntervalForTimestamp(uint256 _timestamp) external view returns (uint256);

    /**
      * @notice Returns current reportInterval id
      */
    function getCurrentReportInterval() external view returns (uint256);

    /**
      * @notice An oracle committee member pushes data from the ETH 2.0 side
      * @param _reportInterval ReportInterval id
      * @param _eth2balance Balance in wei on the ETH 2.0 side
      */
    function pushData(uint256 _reportInterval, uint256 _eth2balance) external;

    /**
      * @notice Returns the latest data from the ETH 2.0 side
      * @dev Depending on the oracle member committee liveness, the data can be stale. See _reportInterval.
      * @return _reportInterval ReportInterval id
      * @return _eth2balance Balance in wei on the ETH 2.0 side
      */
    function getLatestData() external view returns (uint256 reportInterval, uint256 eth2balance);

    // Fired when some _reportInterval reached quorum, was processed and yielded median _eth2balance
    event AggregatedData(uint256 reportInterval, uint256 eth2balance);
}
