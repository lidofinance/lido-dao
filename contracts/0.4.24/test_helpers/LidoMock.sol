// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../Lido.sol";
import "./VaultMock.sol";


/**
 * @dev Only for testing purposes! Lido version with some functions exposed.
 */
contract LidoMock is Lido {
    function getTotalPooledEther() external view returns (uint256) {
        return totalPooledEther;
    }

    function initialize(IERC20 _token) public {
        _setToken(_token);
        initialized();
    }

    function setTotalPooledEther(uint256 _totalPooledEther) public {
        totalPooledEther = _totalPooledEther;
    }

    uint256 private totalPooledEther;
}
