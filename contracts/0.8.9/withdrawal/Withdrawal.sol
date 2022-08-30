// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

pragma solidity =0.8.9;

import "./QueueNFT.sol";

/**
 * TODO: 
 * - check slashing on oracle report
 * - manage timelock for slashing cooldown 
 * - algorithm for discounting the StETH based on slashing/penalties
 * - figure out an NOR interface to intiate validator ejecting
 * - ...
 * - PROFIT!!
 */


/**
  * @title A dedicated contract for handling stETH withdrawal request queue
  * @notice Here we try to figure out how does the withdrawal queue should work
  */
contract Withdrawal is QueueNFT {
  /**
   * We don't want to deel with small amounts because there is a gas spent on oracle 
   * for each request. 
   * But exact threshhold should be defined later when it will be clear how much will 
   * it cost to withdraw.
   */
  uint256 public constant MIN_WITHDRAWAL = 0.1 ether;
  // some calls are allowed only from Lido protocol
  address public immutable OWNER;

  /**
   * We need to count the relevant amount
   */
  uint256 public lockedStETHAmount;
  uint256 public nextTicketId = 0;

  struct Ticket {
    uint256 amountOfStETH ;
    bool finalized;
  }
  mapping(uint256 => Ticket) public queue;

  event WithdrawalRequested(address indexed owner, uint ticketId, uint amountOfStETH);
  event Cashout(address indexed owner, uint ticketId, uint amountOfETH);

  constructor(address _owner) {
    OWNER = _owner;
  }

  /**
   * @notice reserve a place in queue for withdrawal
   * @dev Assuming that stETH is locked before invoking this function 
   * @return ticketId id of a ticket to withdraw funds once it is available
   */
  function request(address _from, uint256 _stethAmount) onlyLido external returns (uint256) {
    // do accounting
    lockedStETHAmount += _stethAmount;

    // issue a ticket
    uint256 ticketId = nextTicketId++;
    queue[ticketId] = Ticket(_stethAmount, false);
    _mint(_from, ticketId);

    emit WithdrawalRequested(_from, ticketId, _stethAmount);

    return ticketId;
  }

  /**
   * @notice Burns a `_ticketId` ticket and transfer reserver ether to `_to` address
   */
  function cashout(address _to, uint256 _ticketId) onlyLido external {
    // check if ticket is 
    address _ticketOwner = ownerOf(_ticketId);
    require(_to == _ticketOwner, "NOT_TICKET_OWNER");
    Ticket memory ticket = queue[_ticketId]; 
    require(ticket.finalized, "TICKET_NOT_FINALIZED");
    // burn an NFT
    _burn(_ticketId);
    // payback
    payable(_ticketOwner).transfer(ticket.amountOfStETH);
    
    // to save some gas
    delete queue[_ticketId];

    emit Cashout(_to, _ticketId, ticket.amountOfStETH);
  }

  /**
   * @notice Use data from oracle report to fulfill requests and request validators' eject if required
   */
  function handleOracleReport() onlyLido external {
    // just mock report for testing
    for (uint i = 0; i < nextTicketId; i++) {
      queue[i].finalized = true;
    }

    // check if slashing
    // secure funds
    // make some tickets withdrawable
    // burn respective amt of StETH if ticket becomes redeemable
    // then we can go to rewards accruing
  }

  modifier onlyLido() {
    require(msg.sender == OWNER, "NOT_OWNER");
    _;
  }
}
