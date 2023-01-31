// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { IStakingRouter } from "../../oracle/AccountingOracle.sol";


contract MockStakingRouterForAccountingOracle is IStakingRouter {

    struct UpdateExitedKeysByModuleCallData {
        uint256[] moduleIds;
        uint256[] exitedKeysCounts;
        uint256 callCount;
    }

    struct ReportExitedKeysByNodeOperatorCallData {
        uint256 stakingModuleId;
        uint256[] nodeOperatorIds;
        uint256[] exitedKeysCounts;
    }

    uint256 internal _exitedKeysCountAcrossAllModules;
    UpdateExitedKeysByModuleCallData internal _updateExitedKeysByModuleLastCall;
    ReportExitedKeysByNodeOperatorCallData[] internal _reportExitedKeysByNodeOperatorCalls;


    function setExitedKeysCountAcrossAllModules(uint256 count) external {
        _exitedKeysCountAcrossAllModules = count;
    }

    function getLastCall_updateExitedKeysByModule()
        external view returns (UpdateExitedKeysByModuleCallData memory)
    {
        return _updateExitedKeysByModuleLastCall;
    }

    function getTotalCalls_reportExitedKeysByNodeOperator() external view returns (uint256) {
        return _reportExitedKeysByNodeOperatorCalls.length;
    }

    function getCall_reportExitedKeysByNodeOperator(uint256 i)
        external view returns (ReportExitedKeysByNodeOperatorCallData memory)
    {
        return _reportExitedKeysByNodeOperatorCalls[i];
    }

    ///
    /// IStakingRouter
    ///

    function getExitedKeysCountAcrossAllModules() external view returns (uint256) {
        return _exitedKeysCountAcrossAllModules;
    }

    function updateExitedKeysCountByStakingModule(
        uint256[] calldata moduleIds,
        uint256[] calldata exitedKeysCounts
    ) external {
        _updateExitedKeysByModuleLastCall.moduleIds = moduleIds;
        _updateExitedKeysByModuleLastCall.exitedKeysCounts = exitedKeysCounts;
        ++_updateExitedKeysByModuleLastCall.callCount;
    }

    function reportStakingModuleExitedKeysCountByNodeOperator(
        uint256 stakingModuleId,
        uint256[] calldata nodeOperatorIds,
        uint256[] calldata exitedKeysCounts
    ) external {
        _reportExitedKeysByNodeOperatorCalls.push(ReportExitedKeysByNodeOperatorCallData(
            stakingModuleId, nodeOperatorIds, exitedKeysCounts
        ));
    }
}
