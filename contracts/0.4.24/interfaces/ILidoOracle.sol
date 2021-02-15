// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

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
      * @notice Returns the number of oracle members required to form a data point
      */
    function getQuorum() external view returns (uint256);

    event MemberAdded(address member);
    event MemberRemoved(address member);
    event QuorumChanged(uint256 quorum);
    event ReportableEpochIdUpdated(uint256 epochId);
    event BeaconReported(
        uint256 epochId,
        uint128 beaconBalance,
        uint128 beaconValidators,
        address caller
    );
    event Completed(
        uint256 epochId,
        uint128 beaconBalance,
        uint128 beaconValidators
    );
    event AllowedBeaconBalanceAnnualRelativeIncreaseSet(uint256 value);
    event AllowedBeaconBalanceRelativeDecreaseSet(uint256 value);



    /**
      * @notice An oracle committee member reports data from the ETH 2.0 side
      * @param _epochId BeaconChain epoch id
      * @param _beaconBalance Balance in wei on the ETH 2.0 side
      * @param _beaconValidators Number of validators visible on this epoch
      */
    function reportBeacon(uint256 _epochId, uint128 _beaconBalance, uint128 _beaconValidators) external;
}
