// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12; // latest available for using OZ

interface ILido {
    function getTotalPooledEther() external view returns (uint256);
    function getEthBalanceByHolder(address _holder) external view returns (uint256);
    function transfer(address _from, address _to, uint256 _stEthAmount) external returns (bool);
    
    function getSharesByPooledEth(uint256 _ethAmount) external view returns (uint256);
    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);
}
