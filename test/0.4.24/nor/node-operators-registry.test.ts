//import { expect } from "chai";
//import { ZeroAddress } from "ethers";
//import { ethers } from "hardhat";

//import {
//    NodeOperatorsRegistryMock,
//    NodeOperatorsRegistryMock__factory,
//} from "typechain-types";

import { Snapshot } from "lib";

describe("NodeOperatorsRegistry", () => {
  let originalState: string;

  before(async () => {});

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("initialize", () => {});

  context("finalizeUpgrade_v2", () => {});

  context("addNodeOperator", () => {});

  context("activateNodeOperator", () => {});

  context("deactivateNodeOperator", () => {});

  context("setNodeOperatorName", () => {});

  context("setNodeOperatorRewardAddress", () => {});

  context("setNodeOperatorStakingLimit", () => {});

  context("onRewardsMinted", () => {});

  context("updateStuckValidatorsCount", () => {});

  context("updateExitedValidatorsCount", () => {});

  context("updateRefundedValidatorsCount", () => {});

  context("onExitedAndStuckValidatorsCountsUpdated", () => {});

  context("unsafeUpdateValidatorsCount", () => {});

  context("updateTargetValidatorsLimits", () => {});

  context("onWithdrawalCredentialsChanged", () => {});

  context("invalidateReadyToDepositKeysRange", () => {});

  context("obtainDepositData", () => {});

  context("getNodeOperator", () => {});

  context("getRewardsDistribution", () => {});

  context("addSigningKeys", () => {});

  context("addSigningKeysOperatorBH", () => {});

  context("removeSigningKey", () => {});

  context("removeSigningKeys", () => {});

  context("removeSigningKeyOperatorBH", () => {});

  context("removeSigningKeysOperatorBH", () => {});

  context("getTotalSigningKeyCount", () => {});

  context("getUnusedSigningKeyCount", () => {});

  context("getSigningKey", () => {});

  context("getSigningKeys", () => {});

  context("getType", () => {});

  context("getStakingModuleSummary", () => {});

  context("getNodeOperatorSummary", () => {});

  context("isOperatorPenalized", () => {});

  context("isOperatorPenaltyCleared", () => {});

  context("clearNodeOperatorPenalty", () => {});

  context("getNodeOperatorsCount", () => {});

  context("getActiveNodeOperatorsCount", () => {});

  context("getNodeOperatorIsActive", () => {});

  context("getNodeOperatorIds", () => {});

  context("getNonce", () => {});

  context("getKeysOpIndex", () => {});

  context("getLocator", () => {});

  context("getStuckPenaltyDelay", () => {});

  context("setStuckPenaltyDelay", () => {});
});
