// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;


/**
  * @dev Only for testing purposes! Lido version with some functions exposed.
  */
contract StETHMockForWithdrawalQueue {

    function getPooledEthByShares(uint256 _sharesAmount)
        external view returns (uint256)
    {
        return (_sharesAmount * 123 * 10**18) / 10**18;
    }

    function getSharesByPooledEth(uint256 _pooledEthAmount)
        external view returns (uint256)
    {
        return (_pooledEthAmount * 899 * 10**18) / 10**18;
    }

}
