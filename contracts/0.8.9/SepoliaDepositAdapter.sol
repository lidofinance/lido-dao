// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


abstract contract SepoliaDepositInterface {

    function get_deposit_root() external virtual view returns (bytes32);

    function get_deposit_count() external virtual view returns (bytes memory);

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external virtual payable;

}

contract SepoliaDepositAdapter {

    uint public constant VERSION = 2;
    address public immutable depositContract;
    address payable public creator;

    constructor(address _deposit_contract) {
        depositContract = _deposit_contract;
        creator = payable(msg.sender);
    }

    function get_deposit_root() external view returns (bytes32) {
        SepoliaDepositInterface origContract = SepoliaDepositInterface(depositContract);
        return origContract.get_deposit_root();
    }

    function get_deposit_count() external view returns (bytes memory) {
        SepoliaDepositInterface origContract = SepoliaDepositInterface(depositContract);
        return origContract.get_deposit_count();
    }

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable {
        SepoliaDepositInterface origContract = SepoliaDepositInterface(depositContract);
        origContract.deposit(pubkey, withdrawal_credentials, signature, deposit_data_root);
    }

    // Public function to send all available funds back to contract creator
    function drain() public {
        creator.transfer(address(this).balance);
    }
}
