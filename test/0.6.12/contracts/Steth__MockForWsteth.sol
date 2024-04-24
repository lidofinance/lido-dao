// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import {StETH} from "contracts/0.4.24/StETH.sol";

contract Steth__MockForWsteth is StETH {
  uint256 private totalPooledEther;

  constructor(address _holder) public payable {
    _resume();
    uint256 balance = address(this).balance;
    assert(balance != 0);

    setTotalPooledEther(balance);
    _mintShares(_holder, balance);
  }

  function _getTotalPooledEther() internal view returns (uint256) {
    return totalPooledEther;
  }

  function setTotalPooledEther(uint256 _totalPooledEther) public {
    totalPooledEther = _totalPooledEther;
  }

  function submit(address _referral) public payable returns (uint256) {
    uint256 sharesAmount = getSharesByPooledEth(msg.value);
    _mintShares(msg.sender, sharesAmount);
    _emitTransferAfterMintingShares(msg.sender, sharesAmount);

    setTotalPooledEther(_getTotalPooledEther() + msg.value);

    return sharesAmount;
  }
}
