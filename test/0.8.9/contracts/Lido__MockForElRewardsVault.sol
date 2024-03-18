// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

contract Lido__MockForElRewardsVault {
    event ELRewardsReceived(uint256 amount);

    function receiveELRewards() external payable {
        emit ELRewardsReceived(msg.value);
    }
}