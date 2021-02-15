// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./openzeppelin_permit/ERC20Permit.sol";
import "./interfaces/IStETH.sol";


/**
 * @title Token wrapper of stETH with static balances.
 * @dev It's an ERC20 token that represents the account's share of the total
 * supply of StETH tokens. LETH token's balance only changes on transfers,
 * unlike StETH that is also changed when oracles report staking rewards,
 * penalties, and slashings. It's a "power user" token that might be needed to
 * work correctly with some DeFi protocols like Uniswap v2, cross-chain bridges,
 * etc.
 *
 * The contract also works as a wrapper that accepts StETH tokens and mints
 * LETH in return. The reverse exchange works exactly the opposite, received
 * LETH token is burned, and StETH token is returned to the user.
 */
contract LETH is ERC20Permit {
    using SafeMath for uint256;

    IStETH public stETH;

    /**
     * @param _stETH address of stETH token to wrap
     */
    constructor(IStETH _stETH)
        public
        ERC20("Wrapped Liquid staked Lido Ether", "LETH")
    {
        stETH = _stETH;
    }

    /**
     * @dev Exchanges stETH to LETH with current ratio.
     * @param _stETHAmount amount of stETH to wrap and get LETH
     *
     * Requirements:
     *  - `_stETHAmount` must be non-zero
     *  - msg.sender must approve at least `_stETHAmount` stETH to this
     *    contract.
     *  - msg.sender must have at least `_stETHAmount` stETH.
     */
    function wrap(uint256 _stETHAmount) public {
        require(_stETHAmount > 0, "LETH: zero amount wrap not allowed");
        uint256 LETHAmount = getLETHByStETH(_stETHAmount);
        _mint(msg.sender, LETHAmount);
        stETH.transferFrom(msg.sender, address(this), _stETHAmount);
    }

    /**
     * @dev Exchanges LETH to stETH with current ratio.
     * @param _LETHAmount amount of LETH to uwrap and get stETH
     *
     * Requirements:
     *  - `_LETHAmount` must be non-zero
     *  - msg.sender must have enough stETH.
     *  - msg.sender must have at least `_stETHAmount` stETH.
     */
    function unwrap(uint256 _LETHAmount) public {
        require(_LETHAmount > 0, "LETH: zero amount unwrap not allowed");
        uint256 stETHAmount = getStETHByLETH(_LETHAmount);
        _burn(msg.sender, _LETHAmount);
        stETH.transfer(msg.sender, stETHAmount);
    }

    /**
     * @dev LETH is equivalent of shares
     * @param _stETHAmount amount of stETH
     * @return Returns amount of LETH with given stETH amount
     */
    function getLETHByStETH(uint256 _stETHAmount) public view returns (uint256) {
        return stETH.getSharesByPooledEth(_stETHAmount);
    }

    /**
     * @dev LETH is equivalent of shares
     * @param _LETHAmount amount of LETH
     * @return Returns amount of stETH with current ratio and given LETH amount
     */
    function getStETHByLETH(uint256 _LETHAmount) public view returns (uint256) {
        return stETH.getPooledEthByShares(_LETHAmount);
    }
}
