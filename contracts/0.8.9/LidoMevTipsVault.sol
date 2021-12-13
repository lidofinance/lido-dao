// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface ILido {
    function mevReceiver() external payable;
}

contract LidoMevTipsVault {
    // Just for debug as in production it would happen too often
    event LidoTxFeeMevReceived(uint256 amount);

    address immutable public lidoAddress;

    constructor(address payable _lidoAddress) {
        // TODO: We don't need proxy, do we?
        lidoAddress = _lidoAddress;
    }

    receive() external payable {
        // TODO: remove
        // This is for debug purposes, as in production fees 
        // and it seems we don't need any kind of handling of accidentally sent funds
        emit LidoTxFeeMevReceived(msg.value);
    }

    function withdrawAllFunds() external returns (uint256) {
        require(msg.sender == lidoAddress, "Nobody except Lido contract can withdraw");
        // TODO: Reentrance guard? Seems no need as nobody except Lido can withdraw at all

        uint256 balance = address(this).balance;
        if (balance > 0) {
            // Note: How to send money to Lido?
            // 1) Cannot send it like this because _submit() on Lido would be called and the funds get deposited as by a user
            //    (bool sent, ) = lidoAddress.call{value: balance }("");
            //    require(sent, "sent");
            // 2) Via a separate payable function on Lido side
            // 3) By using something alike "approve" for ERC-20

            ILido(lidoAddress).mevReceiver{value: balance}();
            return balance;
        }
    }
}