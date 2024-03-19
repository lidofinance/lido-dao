// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "../utils/access/AccessControlEnumerable.sol";
import {IStakingModule} from "../interfaces/IStakingModule.sol";
import {StakingRouter} from "../StakingRouter.sol";
import "../../common/interfaces/ILidoLocator.sol";

interface IStakingRouter {
    function getStakingModule(uint256 _stakingModuleId) external view returns (StakingRouter.StakingModule memory);
}

interface IValidatorsExitBusOracle {
    function submitPriorityReportData(bytes32 reportHash, uint256 requestsCount) external;
}

contract Prover is AccessControlEnumerable {

  ILidoLocator internal immutable LOCATOR;
  IValidatorsExitBusOracle internal immutable ORACLE;

  constructor(address _lidoLocator, address _oracle) {
    LOCATOR = ILidoLocator(_lidoLocator);
    ORACLE = IValidatorsExitBusOracle(_oracle);

    //for test
     _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
  }

  error ErrorKeyIsNotAvailiableToExit();

  function reportKeyToExit(
    uint256 _stakingModuleId,
    uint256 _nodeOperatorId,
    uint256 _index,
    bytes calldata _pubkey,
    bytes32 reportHash
) external {
    IStakingRouter router = IStakingRouter(LOCATOR.stakingRouter());
    address moduleAddress = router.getStakingModule(_stakingModuleId).stakingModuleAddress;
    if (!IStakingModule(moduleAddress).isKeyAvailableToExit(_nodeOperatorId, _index, _pubkey)) {
        revert ErrorKeyIsNotAvailiableToExit();
    }

    ORACLE.submitPriorityReportData(
        reportHash, 1
    );
  }
}
