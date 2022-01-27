// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../StETH.sol";

/**
 * @dev Only for testing purposes!
 * StETH mock version of mintable/burnable/stoppable token.
 */
contract StETHMock is StETH {
    uint256 private totalPooledEther;

    constructor() public {
        _resume();
    }

    function _getTotalPooledEther() internal view returns (uint256) {
        return totalPooledEther;
    }

    function stop() external {
        _stop();
    }

    function resume() external {
        _resume();
    }

    function setTotalPooledEther(uint256 _totalPooledEther) public {
        totalPooledEther = _totalPooledEther;
    }

    function mintShares(address _to, uint256 _sharesAmount)
        public
        returns (uint256 newTotalShares)
    {
        newTotalShares = _mintShares(_to, _sharesAmount);
        _emitTransferAfterMintingShares(_to, _sharesAmount);
    }

    function burnShares(address _account, uint256 _sharesAmount)
        public
        returns (uint256 newTotalShares)
    {
        return _burnShares(_account, _sharesAmount);
    }

    function _emitTransferAfterMintingShares(address _to, uint256 _sharesAmount)
        internal
    {
        emit Transfer(address(0), _to, getPooledEthByShares(_sharesAmount));
        emit TransferShares(address(0), _to, _sharesAmount);
    }
}
