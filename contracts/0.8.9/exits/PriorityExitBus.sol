// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

contract PriorityExitBus {

  struct Validator {
    bytes validatorPubkey;
    uint256 stakingModuleId;
    uint256 nodeOperatorId;
    uint256 validatorIndex;
    uint256 timestamp;
  }

  mapping (uint256=>Validator) public validators;
  uint256 public validatorsCount;

  function add(Validator calldata validator) external returns (uint256) {
    Validator storage val = validators[validator.validatorIndex];
    require(val.timestamp > 0);

    val.nodeOperatorId = validator.nodeOperatorId;
    val.stakingModuleId = validator.stakingModuleId;
    val.validatorIndex = validator.validatorIndex;
    val.timestamp = validator.timestamp;
    val.validatorPubkey = validator.validatorPubkey;


    validatorsCount++;

    return validatorsCount;

  }
}