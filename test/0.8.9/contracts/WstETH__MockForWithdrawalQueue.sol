// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import {ERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-ERC20Permit.sol";

interface IStETH is IERC20, IERC20Permit {
  function getPooledEthByShares(uint256 _stETHAmount) external view returns (uint256);
}

contract WstETH__MockForWithdrawalQueue is ERC20 {

  IStETH public stETH;

  mapping (address => uint256) private _balances;

  uint256 private _totalSupply;

  mapping (address => uint256) internal noncesByAddress;

  bool internal mock__isSignatureValid = true;

  constructor(IStETH _stETH) ERC20("Wrapped liquid staked Ether 2.0", "wstETH") {
    stETH = _stETH;
  }

  // IERC20 implementation

  function approve(address spender, uint256 amount) public override returns (bool) {
    _approve(msg.sender, spender, amount);
    return true;
  }

  function transfer(address recipient, uint256 amount) public override returns (bool) {
    _transfer(msg.sender, recipient, amount);
    return true;
  }

  // WithdrawalQueue tests callables

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

  function nonces(address owner) external view returns (uint256) {
    return noncesByAddress[owner];
  }

  /**
   * @dev See {ERC20Permit-permit}.
   */
  function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
    require(block.timestamp <= deadline, "ERC20Permit: expired deadline");
    require(mock__isSignatureValid, "ERC20Permit: invalid signature");

    _approve(owner, spender, value);
  }

  /**
    * Switches the permit signature validation on or off.
    */
  function mock__setIsSignatureValid(bool _validSignature) external {
    mock__isSignatureValid = _validSignature;
  }
}