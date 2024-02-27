// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import {ERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-ERC20Permit.sol";

import "@openzeppelin/contracts-v4.4/token/ERC20/ERC20.sol";

interface IStETH is IERC20, IERC20Permit {
  function getSharesByPooledEth(uint256 _pooledEthAmount) external view returns (uint256);
  function getPooledEthByShares(uint256 _stETHAmount) external view returns (uint256);
}

/// @notice Interface defining a Lido liquid staking pool wrapper
/// @dev see WstETH.sol for full docs
interface IWstETH is IERC20, IERC20Permit {
  function unwrap(uint256 _wstETHAmount) external returns (uint256);
  function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256);
  function stETH() external view returns (IStETH);
}

contract WstETH__MockForWithdrawalQueue is ERC20 {

  IStETH public stETH;

  mapping (address => uint256) private _balances;

  uint256 private _totalSupply;

  constructor(IStETH _stETH) ERC20("Wrapped liquid staked Ether 2.0", "wstETH") {
    stETH = _stETH;
  }

  function mint(address _recipient, uint256 _amount) public {
    _mint(_recipient, _amount);
  }

  function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256) {
    return stETH.getPooledEthByShares(_wstETHAmount);
  }

  function unwrap(uint256 _wstETHAmount) external returns (uint256) {
    require(_wstETHAmount > 0, "wstETH: zero amount unwrap not allowed");
    uint256 stETHAmount = stETH.getPooledEthByShares(_wstETHAmount);
    _burn(msg.sender, _wstETHAmount);
    stETH.transfer(msg.sender, stETHAmount);
    return stETHAmount;
  }
}