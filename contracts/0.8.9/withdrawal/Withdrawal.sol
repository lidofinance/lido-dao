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

  event StETHQueued(address indexed owner, uint id, uint amount);

  constructor(address _lido) {
    LIDO = _lido;
  }

  /**
   * @notice Locks provided stETH amounts and reserve a place in queue for withdrawal
   */
  function enqueue(uint256 _stethAmount) external returns (uint256) {
    // Lock steth to Withdrawal 
    if (ILido(LIDO).transferFrom(msg.sender, address(this), _stethAmount)) {
      lockedStETHAmount += _stethAmount;
    }

    // Issue NFT
    _mint(msg.sender, nextTokenId);
    emit StETHQueued(msg.sender, nextTokenId, _stethAmount);
    return nextTokenId++;
  }

  function withdraw(uint256 tokenId) external {
    // check if NFT is withdrawable
    // burn an NFT
    // send money to msg.sender
  }

  function handleOracleReport() external {
    // check if slashing
    // secure funds
    // make some NFTs withdrawable
    // burn respective amt of StETH
    // then we can go to rewards accruing
  }
}
