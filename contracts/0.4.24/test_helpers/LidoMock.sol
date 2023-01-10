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
        address _oracle,
        address _treasury,
        address _stakingRouterAddress,
        address _dsmAddress,
        address _executionLayerRewardsVault
    )
        public
    {
        if (_treasury == address(0)) {
            _treasury = new VaultMock();
        }
        if (_executionLayerRewardsVault == address(0)) {
            _executionLayerRewardsVault = new VaultMock();
        }
        super.initialize(_oracle, _treasury, _stakingRouterAddress, _dsmAddress, _executionLayerRewardsVault);
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
