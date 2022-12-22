// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../Lido.sol";
import "./VaultMock.sol";

/**
 * @dev Only for testing purposes! Lido version with some functions exposed.
 */
contract LidoMock is Lido {
    function initialize(
        IDepositContract _depositContract,
        address _oracle
    ) public {
        super.initialize(_depositContract, _oracle, new VaultMock());
    }

    /**
     * @dev For use in tests to make protocol operational after deployment
     */
    function resumeProtocolAndStaking() public {
        _resume();
        _resumeStaking();
    }

    /**
     * @dev Gets unaccounted (excess) Ether on this contract balance
     */
    function getUnaccountedEther() public view returns (uint256) {
        return _getUnaccountedEther();
    }

    /**
     * @dev Only for testing recovery vault
     */
    function makeUnaccountedEther() public payable {}
}
