// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

/**
 * TODO: 
 * 
 * - discounting the StETH based on slashing/penalties
 * 
 * - rebase limit and burn (goes to Lido/StETH as it's responsible for balance management)
 * - MIN_WITHDRAWAL looks like it should be reasonably small, but no dust, indeed. 
 * Can be adjusted later to minimize oracle spendings on queue processing. 
 * My guess that 0.1 ETH should be ok
 * - PROFIT!
 */

/**
  * @title A dedicated contract for handling stETH withdrawal request queue
  * @notice it responsible for:
  * - taking withdrawal requests, issuing a ticket in return
  * - finalizing tickets in queue (making tickets withdrawable)
  * - processing claims for finalized tickets
  * @author folkyatina
  */
contract WithdrawalQueue {
    /**
     * We don't want to deal with small amounts because there is a gas spent on oracle 
     * for each request. 
     * But exact threshhold should be defined later when it will be clear how much will 
     * it cost to withdraw.
     */
    uint256 public constant MIN_WITHDRAWAL = 0.1 ether;

    /**
     * @notice All state-modifying calls are allowed only from owner protocol. 
     * @dev should be Lido
     */ 
    address public immutable OWNER;

    /**
     * @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for cashout
     * @dev Invariant: `lockedETHAmount <= this.balance`
     */
    uint256 public lockedETHAmount = 0;

    /**
     * @notice queue for withdrawas, implemented as mapping of incremental index to respective Ticket
     * @dev We want to delete items on after cashout to save some gas, so we don't use array here.
     */ 
    mapping(uint => Ticket) public queue;
    //mapping(address => uint[]) internal registry;
    
    uint256 public queueLength = 0;
    uint256 public finalizedQueueLength = 0;

    struct Ticket {
        address holder;
        uint256 maxETHToClaim;
        uint256 sharesToBurn;
    }

    constructor(address _owner) {
        OWNER = _owner;
    }

    /**
     * @notice reserve a place in queue for withdrawal and assign a Ticket to `_from` address
     * @dev Assuming that _stethAmount is locked before invoking this function 
     * @return ticketId id of a ticket to withdraw funds once it is available
     */
    function createTicket(address _from, uint256 _ETHToClaim, uint256 _shares) external onlyOwner returns (uint256) {
        // issue a ticket
        uint256 ticketId = queueLength++;
        queue[ticketId] = Ticket(_from, _ETHToClaim, _shares);

        return ticketId;
    }

    /**
     * @notice Mark next tickets finalized up to `lastTicketIdToFinalize` index in the queue.
     * @dev expected that `lastTicketIdToFinalize` is chosen by criteria:
     *  - it is the last ticket that come before the oracle report block
     *  - we have enough money to fullfill it
     */
    function finalizeTickets(
        uint256 lastTicketIdToFinalize, 
        uint256 totalPooledEther,
        uint256 totalShares
    ) external payable onlyOwner returns (uint sharesToBurn) {
        uint ethToLock = 0;
        for (uint i = finalizedQueueLength; i < queueLength; i++) {
            uint ticketShares = queue[i].sharesToBurn;
            uint ticketETH = queue[i].maxETHToClaim;

             // discount for slashing
            uint256 currentEth = totalPooledEther * ticketShares / totalShares;
            if (currentEth < ticketETH) {
                queue[i].maxETHToClaim = currentEth;
                ticketETH = currentEth;
            }

            sharesToBurn += ticketShares;
            ethToLock += ticketETH;
        }

        // check that tickets are came before report and move lastNonFinalizedTicketId 
        // to last ticket that came before report and we have enough ETH for
        require(lockedETHAmount + ethToLock <= address(this).balance, "NOT_ENOUGH_ETHER");

        lockedETHAmount += ethToLock;
        finalizedQueueLength = lastTicketIdToFinalize + 1; 
    }

    /**
     * @notice Burns a `_ticketId` ticket and transfer reserver ether to `_to` address. 
     */
    function withdraw(uint256 _ticketId) external {
        // ticket must be finalized
        require(finalizedQueueLength > _ticketId, "TICKET_NOT_FINALIZED");

        // transfer designated amount to ticket owner
        address ticketHolder = holderOf(_ticketId);
        uint256 ethAmount = queue[_ticketId].maxETHToClaim;

        // find a discount if applicable

        lockedETHAmount -= ethAmount;

        payable(ticketHolder).transfer(ethAmount);
        
        // free storage to save some gas
        delete queue[_ticketId];
    }

    function holderOf(uint256 _ticketId) public view returns (address) {
        address holder = queue[_ticketId].holder;
        require(holder != address(0), "TICKET_NOT_FOUND");
        return holder;
    }

    function _exists(uint256 _ticketId) internal view returns (bool) {
        return queue[_ticketId].holder != address(0);
    }

    modifier onlyOwner() {
        require(msg.sender == OWNER, "NOT_OWNER");
        _;
    }
}
