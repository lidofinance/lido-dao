// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "./QueueNFT.sol";

/**
 * TODO: 
 * - check slashing on oracle report (should be done by oracle or other party and just finalize nothing)
 * - manage timelock for slashing cooldown (can be done on oracle side also, report only on finalized blocks ???)
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
 * Accounting Notes. 
 * It should be moved to a separate logical module. 
 *
 * Looks like we need from the oracle: withdrawedNum, withdrawedSum (including skimming)
 * 
 * ' - is for values that should correspond with current oracle report (which already looks in the past)
 * 
 * totalPooledEther = depositBuffer + _transientDeposits' + beaconBalance' + withdrawedSum' - withdrawableETH' + elRewards   
 * transientDeposits = (depositNum - (beaconNum' + withdrawedNum')) * 32 ETH
 * rewards = ???
 */

/**
  * @title A dedicated contract for handling stETH withdrawal request queue
  * @notice it responsible for:
  * - taking withdrawal requests, issuing a ticket in return
  * - finalizing tickets in queue (making tickets withdrawable)
  * - processing claims for finalized tickets
  * @author folkyatina
  */
contract Withdrawal is QueueNFT {
  /**
   * We don't want to deal with small amounts because there is a gas spent on oracle 
   * for each request. 
   * But exact threshhold should be defined later when it will be clear how much will 
   * it cost to withdraw.
   */
  uint256 public constant MIN_WITHDRAWAL = 0.1 ether;

  // All state-modifying calls are allowed only from Lido protocol. 
  // TODO: Use TrustedCaller from EasyTrack?
  address public immutable OWNER;

  uint256 public withdrawableETHAmount = 0;

  uint256 public nextTicketId = 0;
  uint256 public lastNonFinalizedTicketId = 0;

  // TODO: Move to NFT? 
  struct Ticket {
    // Its equal to StETH for now
    uint256 maxWithdrawableETH;
    uint256 amountOfShares;
    // We don't want to finalize the 
    uint256 blockNumber;
  }

  mapping(uint256 => Ticket) internal queue;

  event WithdrawalRequested(address indexed owner, uint ticketId, uint amountOfStETH);
  event Cashout(address indexed owner, uint ticketId, uint amountOfETH);

  constructor(address _owner) {
    OWNER = _owner;
  }

  /**
   * @notice reserve a place in queue for withdrawal
   * @dev Assuming that _stethAmount is locked before invoking this function 
   * @return ticketId id of a ticket to withdraw funds once it is available
   */
  function request(address _from, uint256 _stethAmount, uint256 _sharesAmount) external onlyOwner returns (uint256) {
    // issue a ticket
    uint256 ticketId = nextTicketId++;
    queue[ticketId] = Ticket(_stethAmount, _sharesAmount, block.number);
    _mint(_from, ticketId);

    emit WithdrawalRequested(_from, ticketId, _stethAmount);

    return ticketId;
  }

  /**
   * @notice Burns a `_ticketId` ticket and transfer reserver ether to `_to` address
   * @dev Assumes that we are burning respected amount of StETH after that method
   */
  function cashout(address _to, uint256 _ticketId) external onlyOwner {
    // check if ticket is valid
    address _ticketOwner = ownerOf(_ticketId);
    require(_to == _ticketOwner, "NOT_TICKET_OWNER");

    // ticket must be finalized
    require(lastNonFinalizedTicketId > _ticketId, "TICKET_NOT_FINALIZED");

    // burn a ticket
    _burn(_ticketId);
    // transfer designated amount
    Ticket storage ticket = queue[_ticketId];

    payable(_ticketOwner).transfer(ticket.maxWithdrawableETH);
    withdrawableETHAmount -= ticket.maxWithdrawableETH;
    
    // free storage to save some gas
    delete queue[_ticketId];

    emit Cashout(_to, _ticketId, ticket.maxWithdrawableETH);
  }

  /**
   * can send along some ETH to do more withdrawals
   */
  function finalizeNextTickets(
    uint256 amountOfETHToDistribute, 
    uint256 reportBlock
  ) external payable onlyOwner returns (uint sharesToBurn, uint ethToEject) {

    require(address(this).balance >= withdrawableETHAmount + amountOfETHToDistribute);

    // some discount for slashing 
    
    // check that tickets are came before report and move lastNonFinalizedTicketId 
    // to last ticket that came before report and we have enough ETH for
    
    // lastNonFinalizedTicketId += n; 
    withdrawableETHAmount += amountOfETHToDistribute;
  }

  modifier onlyOwner() {
    require(msg.sender == OWNER, "NOT_OWNER");
    _;
  }
}
