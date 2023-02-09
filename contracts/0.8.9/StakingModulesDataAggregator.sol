// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {ILidoLocator} from "../common/interfaces/ILidoLocator.sol";
import {IStakingModule, ValidatorsReport} from "./interfaces/IStakingModule.sol";

interface IStakingRouter {
    struct StakingModule {
        /// @notice unique id of the staking module
        uint24 id;
        /// @notice address of staking module
        address stakingModuleAddress;
        /// @notice part of the fee taken from staking rewards that goes to the staking module
        uint16 stakingModuleFee;
        /// @notice part of the fee taken from staking rewards that goes to the treasury
        uint16 treasuryFee;
        /// @notice target percent of total validators in protocol, in BP
        uint16 targetShare;
        /// @notice staking module status if staking module can not accept the deposits or can participate in further reward distribution
        uint8 status;
        /// @notice name of staking module
        string name;
        /// @notice block.timestamp of the last deposit of the staking module
        uint64 lastDepositAt;
        /// @notice block.number of the last deposit of the staking module
        uint256 lastDepositBlock;
        /// @notice number of exited validators
        uint256 exitedValidatorsCount;
    }

    function getAllStakingModuleIds() external view returns (uint24[] memory);

    function getStakingModule(uint256 _stakingModuleId) external view returns (StakingModule memory);
}

/// @title Staking modules data aggregator
/// @notice Provides views for convenient off-chain staking modules data collecting
/// @dev WARNING: This contract is not supposed to be used for onchain calls due to high gas costs 
///     for data aggregation
contract StakingModulesDataAggregator {
    struct StakingModuleSummary {
        uint256 nodeOperatorsCount;
        uint256 activeNodeOperatorsCount;
        ValidatorsReport validatorsReport;
        IStakingRouter.StakingModule state;
    }

    struct NodeOperatorSummary {
        bool isActive;
        uint256 nodeOperatorId;
        ValidatorsReport validatorsReport;
    }

    ILidoLocator private LIDO_LOCATOR;

    constructor(address _lidoLocator) {
        LIDO_LOCATOR = ILidoLocator(_lidoLocator);
    }

    function getLidoLocator() external view returns (ILidoLocator) {
        return LIDO_LOCATOR;
    }

    function getStakingRouter() public view returns (IStakingRouter) {
        return IStakingRouter(LIDO_LOCATOR.stakingRouter());
    }

    function getAllStakingModuleIds() public view returns (uint24[] memory) {
        return getStakingRouter().getAllStakingModuleIds();
    }

    function getAllStakingModulesSummary() external view returns (StakingModuleSummary[] memory) {
        IStakingRouter stakingRouter = getStakingRouter();
        return getStakingModulesSummary(stakingRouter.getAllStakingModuleIds());
    }

    function getStakingModulesSummary(uint24[] memory _stakingModuleIds)
        public
        view
        returns (StakingModuleSummary[] memory summaries)
    {
        IStakingRouter stakingRouter = getStakingRouter();
        summaries = new StakingModuleSummary[](_stakingModuleIds.length);
        for (uint256 i = 0; i < _stakingModuleIds.length; ++i) {
            IStakingRouter.StakingModule memory stakingModuleState = stakingRouter.getStakingModule(
                _stakingModuleIds[i]
            );
            IStakingModule stakingModule = IStakingModule(stakingModuleState.stakingModuleAddress);
            summaries[i] = StakingModuleSummary({
                state: stakingModuleState,
                nodeOperatorsCount: stakingModule.getNodeOperatorsCount(),
                activeNodeOperatorsCount: stakingModule.getActiveNodeOperatorsCount(),
                validatorsReport: stakingModule.getValidatorsReport()
            });
        }
    }

    function getAllNodeOperatorsSummary(uint256 _stakingModuleId) external view returns (NodeOperatorSummary[] memory) {
        IStakingModule stakingModule = _getStakingModule(_stakingModuleId);
        uint256 nodeOperatorsCount = stakingModule.getNodeOperatorsCount();
        return getNodeOperatorsSummary(_stakingModuleId, 0, nodeOperatorsCount);
    }

    function getNodeOperatorsSummary(
        uint256 _stakingModuleId,
        uint256 _offset,
        uint256 _limit
    ) public view returns (NodeOperatorSummary[] memory summaries) {
        IStakingModule stakingModule = _getStakingModule(_stakingModuleId);
        uint256[] memory nodeOperatorIds = stakingModule.getNodeOperatorIds(_offset, _limit);
        summaries = new NodeOperatorSummary[](nodeOperatorIds.length);
        for (uint256 i = 0; i < nodeOperatorIds.length; ++i) {
            bool isActive = stakingModule.getNodeOperatorIsActive(nodeOperatorIds[i]);
            summaries[i] = NodeOperatorSummary({
                isActive: isActive,
                nodeOperatorId: nodeOperatorIds[i],
                validatorsReport: stakingModule.getValidatorsReport(nodeOperatorIds[i])
            });
        }
    }

    function _getStakingModule(uint256 _stakingModuleId) private view returns (IStakingModule) {
        return IStakingModule(getStakingRouter().getStakingModule(_stakingModuleId).stakingModuleAddress);
    }
}
