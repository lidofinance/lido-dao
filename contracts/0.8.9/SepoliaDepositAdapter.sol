// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/access/Ownable.sol";

import "hardhat/console.sol";

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

contract SepoliaDepositAdapter is Ownable {

    uint public constant VERSION = 2;
    ISepoliaDepositContract public immutable originalContract;

    constructor(address _deposit_contract) {
        originalContract = ISepoliaDepositContract(_deposit_contract);
    }

    function get_deposit_root() external view returns (bytes32) {
        return originalContract.get_deposit_root();
    }

    function get_deposit_count() external view returns (bytes memory) {
        return originalContract.get_deposit_count();
    }

    function name() external view returns (string memory) {
        return originalContract.name();
    }

    receive() external payable {
        console.log(
          "Receive %s from %s",
            msg.value,
            msg.sender
        );
    }

    function drain(address payable destination) external onlyOwner {
        uint balance = address(this).balance;
        destination.transfer(balance);
    }

    function drainBepolia() external onlyOwner {
        uint bepoliaOwnTokens = originalContract.balanceOf(address(this));
        bool success = originalContract.transfer(owner(), bepoliaOwnTokens);
        require(success, "Transfer failed");
    }    

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable {
        console.log(
          "Deposit with %s ETH from %s",
            msg.value,
            msg.sender
        );
        originalContract.deposit{value: msg.value}(pubkey, withdrawal_credentials, signature, deposit_data_root);
        address payable owner = payable(owner());
        owner.transfer(msg.value);
    }
}
