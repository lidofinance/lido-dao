// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";

// Sepolia deposit contract variant of the source code https://github.com/protolambda/testnet-dep-contract/blob/master/deposit_contract.sol
interface ISepoliaDepositContract is IERC20 {

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable;

    function get_deposit_root() external view returns (bytes32);

    function get_deposit_count() external view returns (bytes memory);

    function name() external view returns (string memory);
}

contract SepoliaDepositAdapter {

    uint public constant VERSION = 2;
    ISepoliaDepositContract public originalContract;

    address payable public immutable creator;

    constructor(address _deposit_contract) {
        originalContract = ISepoliaDepositContract(_deposit_contract);
        creator = payable(msg.sender);
    }

    function get_deposit_root() external view returns (bytes32) {
        return originalContract.get_deposit_root();
    }

    function get_deposit_count() external view returns (bytes memory) {
        return originalContract.get_deposit_count();
    }

    function test() external view returns (string memory) {
        return originalContract.name();
    }

    receive() external payable {}

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable {
        originalContract.deposit(pubkey, withdrawal_credentials, signature, deposit_data_root);
    }

    // Public function to send all available funds back to contract creator
    function drain() public {
        creator.transfer(address(this).balance);
    }
}
