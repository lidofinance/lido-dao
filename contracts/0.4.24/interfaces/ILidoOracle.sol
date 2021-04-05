// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../interfaces/ILido.sol";


/**
  * @title ETH 2.0 -> ETH oracle
  *
  * The goal of the oracle is to inform other parts of the system about balances controlled by the
  * DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down
  * because of slashing.
  */
interface ILidoOracle {
    event AllowedBeaconBalanceAnnualRelativeIncreaseSet(uint256 value);
    event AllowedBeaconBalanceRelativeDecreaseSet(uint256 value);
    event BeaconReportReceiverSet(address callback);
    event MemberAdded(address member);
    event MemberRemoved(address member);
    event QuorumChanged(uint256 quorum);
    event ExpectedEpochIdUpdated(uint256 epochId);
    event BeaconSpecSet(
        uint64 epochsPerFrame,
        uint64 slotsPerEpoch,
        uint64 secondsPerSlot,
        uint64 genesisTime
    );
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
    event PostTotalShares(
         uint256 postTotalPooledEther,
         uint256 preTotalPooledEther,
         uint256 timeElapsed,
         uint256 totalShares);
    event ContractVersionSet(uint256 version);

    /**
     * Returns the Lido contract address
     */
    function getLido() public view returns (ILido);

    /**
     * Returns the number of exactly the same reports needed to finalize the epoch
     */
    function getQuorum() public view returns (uint256);

    /**
     * Returns the upper bound of the reported balance possible increase in APR
     */
    function getAllowedBeaconBalanceAnnualRelativeIncrease() public view returns (uint256);

    /**
     * Returns the lower bound of the reported balance possible decrease
     */
    function getAllowedBeaconBalanceRelativeDecrease() public view returns (uint256);

    function setAllowedBeaconBalanceAnnualRelativeIncrease(uint256 _value) external;
    function setAllowedBeaconBalanceRelativeDecrease(uint256 _value) external;

    /**
     * Returns the receiver contract address to be called when the report is pushed to Lido
     */
    function getBeaconReportReceiver() external view returns (address);

    /**
     * Sets the receiver contract address to be called when the report is pushed to Lido
     */
    function setBeaconReportReceiver(address _addr) external;

    /**
     * Returns the current reporting bitmap, representing oracles who have already pushed their
     * version of report during the expected epoch
     */
    function getCurrentOraclesReportStatus() external view returns (uint256);

    /**
     * Returns the current reporting array size
     */
    function getCurrentReportVariantsSize() external view returns (uint256);

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
        );

    /**
     * Returns epoch that can be reported by oracles
     */
    function getExpectedEpochId() external view returns (uint256);

    /**
     * Returns the current oracle member committee list
     */
    function getOracleMembers() external view returns (address[]);

    /**
     * Returns the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256);

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
        );

    /**
     * Updates beacon specification data
     */
    function setBeaconSpec(
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )              
        external;

    /**
     * Returns the epoch calculated from current timestamp
     */
    function getCurrentEpochId() external view returns (uint256);

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
        );

    /**
     * Reports beacon balance and its change during the last frame
     */
    function getLastCompletedReportDelta()
        external
        view
        returns (
            uint256 postTotalPooledEther,
            uint256 preTotalPooledEther,
            uint256 timeElapsed
        );
    
    /**
     * Initialize contract data, that is new to v2
     */
    function initialize_v2(
        uint256 _allowedBeaconBalanceAnnualRelativeIncrease,
        uint256 _allowedBeaconBalanceRelativeDecrease
    )
        external;
    
    /**
     * Adds the given address to the oracle member committee list
     */
    function addOracleMember(address _member) external;

    /**
     * Removes the given address from the oracle member committee list
     */
    function removeOracleMember(address _member) external;

    /**
      * Sets the number of erectly the same reports needed to finalize the epoch
      */
    function setQuorum(uint256 _quorum) external;

    /**
     * Accepts oracle committee member reports from the ETH 2.0 side
     * @param _epochId Beacon chain epoch
     * @param _beaconBalance Balance in wei on the ETH 2.0 side (9-digit denomination)
     * @param _beaconValidators Number of validators visible in this epoch
     */
    function reportBeacon(uint256 _epochId, uint64 _beaconBalance, uint32 _beaconValidators) external;
}
