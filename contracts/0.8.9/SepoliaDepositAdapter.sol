// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/access/Ownable.sol";

interface IDepositContract {
    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable;

    function get_deposit_root() external view returns (bytes32);

    function get_deposit_count() external view returns (bytes memory);
}

// Sepolia deposit contract variant of the source code https://github.com/protolambda/testnet-dep-contract/blob/master/deposit_contract.sol
interface ISepoliaDepositContract is IDepositContract, IERC20 { }

// Sepolia testnet deposit contract have a different interface than the mainnet deposit contract.
// This adapter is used to make the mainnet deposit contract compatible with the testnet deposit contract.
// For further information see Sepolia deposit contract variant source code link above.
contract SepoliaDepositAdapter is IDepositContract, Ownable {

    event EthReceived(address sender, uint256 amount);

    event EthRecovered(uint256 amount);

    error EthRecoverFailed();

    error BepoliaRecoverFailed();

    error DepositFailed();

    ISepoliaDepositContract public immutable originalContract;

    constructor(address _deposit_contract) {
        originalContract = ISepoliaDepositContract(_deposit_contract);
    }

    function get_deposit_root() override external view returns (bytes32) {
        return originalContract.get_deposit_root();
    }

    function get_deposit_count() override external view returns (bytes memory) {
        return originalContract.get_deposit_count();
    }

    receive() external payable {
        emit EthReceived(msg.sender, msg.value);
    }

    function recoverEth() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success,) = owner().call{value: balance}("");
        if (!success) {
            revert EthRecoverFailed();
        }
        emit EthRecovered(balance);
    }

    function recoverBepolia() external onlyOwner {
        uint256 bepoliaOwnTokens = originalContract.balanceOf(address(this));
        bool success = originalContract.transfer(owner(), bepoliaOwnTokens);
        if (!success) {
            revert BepoliaRecoverFailed();
        }
    }    

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) override external payable {
        originalContract.deposit{value: msg.value}(pubkey, withdrawal_credentials, signature, deposit_data_root);
        (bool success,) = owner().call{value: msg.value}("");
        if (!success) {
            revert DepositFailed();
        }
    }
}
