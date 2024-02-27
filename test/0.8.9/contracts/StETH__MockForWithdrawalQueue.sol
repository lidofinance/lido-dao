//// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
//// SPDX-License-Identifier: GPL-3.0
//// for testing purposes only

pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";

import {UnstructuredStorage} from "contracts/0.8.9/lib/UnstructuredStorage.sol";

contract StETH__MockForWithdrawalQueue is IERC20 {
  using UnstructuredStorage for bytes32;

  uint256 constant internal INFINITE_ALLOWANCE = ~uint256(0);

  uint256 public totalShares;
  uint256 public totalPooledEther;

  bytes32 internal constant TOTAL_SHARES_POSITION = 0xe3b4b636e601189b5f4c6742edf2538ac12bb61ed03e6da26949d69838fa447e;

  mapping(address => uint256) private shares;

  mapping(address => mapping(address => uint256)) private allowances;

  mapping(address => uint256) internal noncesByAddress;

  event TransferShares(
    address indexed from,
    address indexed to,
    uint256 sharesValue
  );

  bool internal mock__signatureIsValid = true;

  constructor() {}

  // IERC20 implementation

  function allowance(address _owner, address _spender) external view returns (uint256) {
    return allowances[_owner][_spender];
  }

  function approve(address _spender, uint256 _amount) external returns (bool) {
    _approve(msg.sender, _spender, _amount);
    return true;
  }

  function balanceOf(address _account) external view returns (uint256) {
    return getPooledEthByShares(shares[_account]);
  }

  function totalSupply() external view returns (uint256) {
    return totalPooledEther;
  }

  function transfer(address _recipient, uint256 _amount) external returns (bool) {
    _transfer(msg.sender, _recipient, _amount);
    return true;
  }

  function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool) {
    _spendAllowance(_sender, msg.sender, _amount);
    _transfer(_sender, _recipient, _amount);
    return true;
  }

  // WithdrawalQueue tests callables

  function getSharesByPooledEth(uint256 _ethAmount) public view returns (uint256) {
    return _ethAmount * _getTotalShares() / totalPooledEther;
  }

  function setTotalPooledEther(uint256 _totalPooledEther) external {
    totalPooledEther = _totalPooledEther;
  }

  function getPooledEthByShares(uint256 _sharesAmount) public view returns (uint256) {
    return _sharesAmount * totalPooledEther / _getTotalShares();
  }

  function mintShares(address _to, uint256 _sharesAmount) public returns (uint256 newTotalShares) {
    newTotalShares = _getTotalShares() + _sharesAmount;
    TOTAL_SHARES_POSITION.setStorageUint256(newTotalShares);

    shares[_to] = shares[_to] + _sharesAmount;

    _emitTransferAfterMintingShares(_to, _sharesAmount);
  }

  function nonces(address owner) external view returns (uint256) {
    return noncesByAddress[owner];
  }

  function permit(
    address _owner, address _spender, uint256 _value, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s
  ) external {
    require(block.timestamp <= _deadline, "DEADLINE_EXPIRED");
    require(mock__signatureIsValid, "INVALID_SIGNATURE");

    _approve(_owner, _spender, _value);
  }

  // Internal methods

  function _emitTransferEvents(address _from, address _to, uint _tokenAmount, uint256 _sharesAmount) internal {
    emit Transfer(_from, _to, _tokenAmount);
    emit TransferShares(_from, _to, _sharesAmount);
  }

  function _emitTransferAfterMintingShares(address _to, uint256 _sharesAmount) internal {
    _emitTransferEvents(address(0), _to, getPooledEthByShares(_sharesAmount), _sharesAmount);
  }

  function _getTotalShares() internal view returns (uint256) {
    return TOTAL_SHARES_POSITION.getStorageUint256();
  }

  function _approve(address _owner, address _spender, uint256 _amount) internal {
    require(_owner != address(0), "APPROVE_FROM_ZERO_ADDR");
    require(_spender != address(0), "APPROVE_TO_ZERO_ADDR");

    allowances[_owner][_spender] = _amount;
    emit Approval(_owner, _spender, _amount);
  }

  function _spendAllowance(address _owner, address _spender, uint256 _amount) internal {
    uint256 currentAllowance = allowances[_owner][_spender];
    if (currentAllowance != INFINITE_ALLOWANCE) {
      require(currentAllowance >= _amount, "ALLOWANCE_EXCEEDED");
      _approve(_owner, _spender, currentAllowance - _amount);
    }
  }

  function _transfer(address _sender, address _recipient, uint256 _amount) internal {
    uint256 _sharesToTransfer = getSharesByPooledEth(_amount);
    _transferShares(_sender, _recipient, _sharesToTransfer);
    _emitTransferEvents(_sender, _recipient, _amount, _sharesToTransfer);
  }

  function _transferShares(address _sender, address _recipient, uint256 _sharesAmount) internal {
    require(_sender != address(0), "TRANSFER_FROM_ZERO_ADDR");
    require(_recipient != address(0), "TRANSFER_TO_ZERO_ADDR");
    require(_recipient != address(this), "TRANSFER_TO_STETH_CONTRACT");

    uint256 currentSenderShares = shares[_sender];
    require(_sharesAmount <= currentSenderShares, "BALANCE_EXCEEDED");

    shares[_sender] = currentSenderShares - _sharesAmount;
    shares[_recipient] = shares[_recipient] + _sharesAmount;
  }

  /**
    * Switches the permit signature validation on or off.
    */
  function mock__setSignatureIsValid(bool _validSignature) external {
    mock__signatureIsValid = _validSignature;
  }
}