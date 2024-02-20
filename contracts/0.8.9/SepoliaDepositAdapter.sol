// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/access/Ownable.sol";

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

    ISepoliaDepositContract public immutable originalContract;

    error TransferFailed();

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
    }

    function recoverEth() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success,) = owner().call{value: balance}("");
        if (!success) {
            revert TransferFailed();
        }
    }

    function recoverBepolia() external onlyOwner {
        uint256 bepoliaOwnTokens = originalContract.balanceOf(address(this));
        bool success = originalContract.transfer(owner(), bepoliaOwnTokens);
        if (!success) {
            revert TransferFailed();
        }
    }    

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable {
        originalContract.deposit{value: msg.value}(pubkey, withdrawal_credentials, signature, deposit_data_root);
        (bool success,) = owner().call{value: msg.value}("");
        if (!success) {
            revert TransferFailed();
        }
    }
}
