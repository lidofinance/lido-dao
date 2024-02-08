// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

import "../0.6.11/sepolia_deposit_contract.sol";

/* See contracts/COMPILERS.md */
// pragma solidity 0.8.9;
pragma solidity >=0.6.8 <0.9.0;


contract SepoliaDepositAdapter {

    uint public constant VERSION = 2;
    SepoliaDepositContract origContract;

    address payable public creator;

    constructor(address _deposit_contract) public {
        origContract = SepoliaDepositContract(_deposit_contract);
        creator = payable(msg.sender);
    }

    function get_deposit_root() external view returns (bytes32) {
        return origContract.get_deposit_root();
    }

    function get_deposit_count() external view returns (bytes memory) {
        return origContract.get_deposit_count();
    }

    function test() external view returns (string memory) {
        return origContract.name();
    }

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable {
        origContract.deposit(pubkey, withdrawal_credentials, signature, deposit_data_root);
    }

    // Public function to send all available funds back to contract creator
    function drain() public {
        creator.transfer(address(this).balance);
    }
}
