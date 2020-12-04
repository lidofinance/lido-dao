// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../StETH.sol";

/**
 * @dev Only for testing purposes!
 * Lido mock version without node operators, depositing and oracles.
 */
contract MockStETH is StETH {
    uint256 private totalPooledEther;

    function() external payable {
        _submit();
    }

    function _getTotalPooledEther() internal view returns (uint256) {
        return totalPooledEther;
    }

    // To test slashing
    function setTotalPooledEther(uint256 _totalPooledEther) public {
        totalPooledEther = _totalPooledEther;
    }

    function _submit() internal returns (uint256) {
        address sender = msg.sender;
        uint256 deposit = msg.value;
        require(deposit != 0, "ZERO_DEPOSIT");

        uint256 sharesAmount = getSharesByPooledEth(deposit);
        if (sharesAmount == 0) {
            // totalControlledEther is 0: either the first-ever deposit or complete slashing
            // assume that shares correspond to Ether 1-to-1
            _mintShares(sender, deposit);
            _emitTransferAfterMintingShares(sender, deposit);
        } else {
            _mintShares(sender, sharesAmount);
            _emitTransferAfterMintingShares(sender, sharesAmount);
        }        

        totalPooledEther = totalPooledEther.add(deposit);

        return sharesAmount;
    }

    function _emitTransferAfterMintingShares(address _to, uint256 _sharesAmount) internal {
        emit Transfer(address(0), _to, getPooledEthByShares(_sharesAmount));
    }
    
    function stop() external {
        _stop();
    }

    function resume() external {
        _resume();
    }
}
