// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

pragma solidity =0.8.9;

import "./QueueNFT.sol";

interface ILido {
  function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/**
  * @title A dedicated contract for handling stETH withdrawal requests
  * @notice Here we try to figure out how does the withdrawal queue should work
  */
contract Withdrawal is QueueNFT {
  uint256 public constant MIN_WITHDRAWAL = 0.1 ether;
  // We need a lido address to burn and lock shares
  address public immutable LIDO;

  uint256 public lockedStETHAmount;
  uint256 public nextTokenId = 0;

  // Can shrink to one slot
  struct Ticket {
    uint256 amount ;
    bool redeemable;
  }
  mapping(uint256 => Ticket) queue;

  event Requested(address indexed owner, uint tokenId, uint amount);
  event Redeemed(address indexed owner, uint tokenId, uint amount);

  constructor(address _lido) {
    LIDO = _lido;
  }

  /**
   * @notice Locks provided stETH amounts and reserve a place in queue for withdrawal
   */
  function request(uint256 stethAmount) external returns (uint256) {
    require(stethAmount >= MIN_WITHDRAWAL, "NO_DUST_WITHDRAWAL");

    // Lock steth to Withdrawal 
    if (ILido(LIDO).transferFrom(msg.sender, address(this), stethAmount)) {
      lockedStETHAmount += stethAmount;
    }

    // Issue a proto-NFT
    _mint(msg.sender, nextTokenId);
    queue[nextTokenId] = Ticket(stethAmount, false);

    emit Requested(msg.sender, nextTokenId, stethAmount);
    return nextTokenId++;
  }

  function redeem(uint256 tokenId) external {
    // check if NFT is withdrawable
    require(msg.sender == ownerOf(tokenId), "SENDER_NOT_OWNER");
    Ticket storage ticket = queue[tokenId]; 
    require(ticket.redeemable, "TOKEN_NOT_REDEEMABLE");
    // burn an NFT
    _burn(tokenId);
    // send money to msg.sender
    payable(msg.sender).transfer(ticket.amount);
    emit Redeemed(msg.sender, tokenId, queue[tokenId].amount);
  }

  function handleOracleReport() external {
    for (uint i = 0; i < nextTokenId; i++) {
      queue[i].redeemable = true;
    }

    // check if slashing
    // secure funds
    // make some NFTs withdrawable
    // burn respective amt of StETH
    // then we can go to rewards accruing
  }
}
