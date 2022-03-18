// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


interface ILDOProxy {

    function totalSupply() public constant returns (uint256);
    function totalSupplyAt(uint _blockNumber) public constant returns (uint256);
    function balanceOf(address _owner) public constant returns (uint256 balance);
    function balanceOfAt(address _owner, uint _blockNumber) public constant returns (uint);
    function delegate(address delegatee) public ;
    function delegateFrom(address delegator, address delegatee, uint256 amount) public;

    function getCurrentVotes(address account) external view returns (uint256);

}