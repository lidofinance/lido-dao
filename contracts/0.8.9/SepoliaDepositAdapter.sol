// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


contract SepoliaDepositAdapter {

    uint public constant TEST_VALUE = 16;
    address public immutable depositContract;

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable {
    }

    constructor(address _deposit_contract) {
        depositContract = _deposit_contract;
    }



}
