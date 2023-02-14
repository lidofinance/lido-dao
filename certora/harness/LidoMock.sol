// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
// Lido is originally 0.4.24 - mock contract compiler was upgraded.
pragma solidity 0.6.11;

interface LidoMockInterface {
    function receiveStakingRouterDepositRemainder() external payable;
    function getDepositableEther() external view returns(uint256);
}

contract LidoMock is LidoMockInterface {
    address public stakingRouter;
    uint256 internal _DepositableEther;

    // The amount of ETH sent from StakingRouter contract to Lido contract when deposit called
    event StakingRouterDepositRemainderReceived(uint256 amount);

    constructor(address _stakingRouter) public {
        stakingRouter = _stakingRouter;
    }

    /**
     * @notice A payable function for staking router deposits remainder. Can be called only by StakingRouter
     * @dev We need a dedicated function because funds received by the default payable function
     * are treated as a user deposit
     */
    function receiveStakingRouterDepositRemainder() external override payable {
        require(msg.sender == stakingRouter);

        emit StakingRouterDepositRemainderReceived(msg.value);
    }

    /**
    * @notice Get the amount of Ether temporary buffered on this contract balance
    * @dev Buffered balance is kept on the contract from the moment the funds are received from user
    * until the moment they are actually sent to the official Deposit contract.
    * @return amount of buffered funds in wei
    */
    function getDepositableEther() external override view returns (uint256) {
        return _DepositableEther;
    }
}