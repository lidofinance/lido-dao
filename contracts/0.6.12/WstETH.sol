// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.6.12;

import "@openzeppelin/contracts/drafts/ERC20Permit.sol";
import "./interfaces/IStETH.sol";

/**
 * @title Token wrapper of stETH with static balances.
 * @dev It's an ERC20 token that represents the account's share of the total
 * supply of StETH tokens. wstETH token's balance only changes on transfers,
 * unlike StETH that is also changed when oracles report staking rewards,
 * penalties, and slashings. It's a "power user" token that might be needed to
 * work correctly with some DeFi protocols like Uniswap v2, cross-chain bridges,
 * etc.
 *
 * The contract also works as a wrapper that accepts StETH tokens and mints
 * wstETH in return. The reverse exchange works exactly the opposite, received
 * wstETH token is burned, and StETH token is returned to the user.
 */
contract WstETH is ERC20Permit {
    IStETH public stETH;

    /**
     * @param _stETH address of Lido/stETH token to wrap
     */
    constructor(IStETH _stETH)
        public
        ERC20Permit("Wrapped liquid staked Ether 2.0")
        ERC20("Wrapped liquid staked Ether 2.0", "wstETH")
    {
        stETH = _stETH;
    }

    /**
     * @dev Exchanges stETH to wstETH with current ratio.
     * @param _stETHAmount amount of stETH to wrap and get wstETH
     *
     * Requirements:
     *  - `_stETHAmount` must be non-zero
     *  - msg.sender must approve at least `_stETHAmount` stETH to this
     *    contract.
     *  - msg.sender must have at least `_stETHAmount` stETH.
     */
    function wrap(uint256 _stETHAmount) external returns (uint256) {
        require(_stETHAmount > 0, "wstETH: can't wrap zero stETH");
        uint256 wstETHAmount = stETH.getSharesByPooledEth(_stETHAmount);
        _mint(msg.sender, wstETHAmount);
        stETH.transferFrom(msg.sender, address(this), _stETHAmount);
        return wstETHAmount;
    }

    /**
     * @dev Exchanges wstETH to stETH with current ratio.
     * @param _wstETHAmount amount of wstETH to uwrap and get stETH
     *
     * Requirements:
     *  - `_wstETHAmount` must be non-zero
     *  - msg.sender must have enough stETH.
     *  - msg.sender must have at least `_stETHAmount` stETH.
     */
    function unwrap(uint256 _wstETHAmount) external returns (uint256) {
        require(_wstETHAmount > 0, "wstETH: zero amount unwrap not allowed");
        uint256 stETHAmount = stETH.getPooledEthByShares(_wstETHAmount);
        _burn(msg.sender, _wstETHAmount);
        stETH.transfer(msg.sender, stETHAmount);
        return stETHAmount;
    }

    /**
    * @notice Send funds to the pool and get wrapped wstETH tokens
    */
    receive() external payable {
        uint256 shares = stETH.submit{value: msg.value}(address(0));
        _mint(msg.sender, shares);
    }

    /**
     * @dev wstETH is equivalent of shares
     * @param _stETHAmount amount of stETH
     * @return Returns amount of wstETH with given stETH amount
     */
    function getWstETHByStETH(uint256 _stETHAmount) external view returns (uint256) {
        return stETH.getSharesByPooledEth(_stETHAmount);
    }

    /**
     * @dev wstETH is equivalent of shares
     * @param _wstETHAmount amount of wstETH
     * @return Returns amount of stETH with current ratio and given wstETH amount
     */
    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256) {
        return stETH.getPooledEthByShares(_wstETHAmount);
    }
}
