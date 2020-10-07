pragma solidity 0.6.12; // latest available for using OZ

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Token wrapper of stETH with static balances
 * @dev It's an ERC20 token that represents the account's share of the total
 * supply of StETH tokens. CStETH token's balance only changes on transfers,
 * unlike StETH that is also changed when oracles report staking rewards,
 * penalties, and slashings. It's a "power user" token that might be needed to
 * work correctly with some DeFi protocols like Uniswap v2, cross-chain bridges,
 * etc.
 *
 * The contract also works as a wrapper that accepts StETH tokens and mints
 * CStETH in return. The reverse exchange works exactly the opposite, received
 * CStETH token is burned, and StETH token is returned to the user.
 */
contract CstETH is ERC20, ERC20Burnable {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    ERC20 public stETH;

    /**
     * @param _stETH address of stETH token to wrap
     */
    constructor(ERC20 _stETH)
        public
        ERC20("Wrapped Liquid staked DePool Ether", "cstETH")
    {
        stETH = _stETH;
    }

    /**
     * @dev Exchanges stETH to cstETH with dynamically calculated ratio.
     * @param _stETHAmount amount of stETH to wrap and get cstETH
     *
     * Requirements:
     *  - `_stETHAmount` must be non-zero
     *  - msg.sender must approve at least `_stETHAmount` stETH to this
     *    contract.
     *  - msg.sender must have at least `_stETHAmount` stETH.
     */
    function wrap(uint256 _stETHAmount) public {
        require(_stETHAmount > 0, "CstETH: zero amount wrap not allowed");
        uint256 cstETHAmount = getCstETHByStETH(_stETHAmount);
        _mint(msg.sender, cstETHAmount);
        stETH.safeTransferFrom(msg.sender, address(this), _stETHAmount);
    }

    /**
     * @dev Exchanges cstETH to stETH with dynamically calculated on each
     * transact ratio.
     * @param _cstETHAmount amount of cstETH to uwrap and get stETH
     *
     * Requirements:
     *  - `_cstETHAmount` must be non-zero
     *  - msg.sender must have enough stETH.
     *  - msg.sender must have at least `_stETHAmount` stETH.
     */
    function unwrap(uint256 _cstETHAmount) public {
        require(_cstETHAmount > 0, "CstETH: zero amount unwrap not allowed");
        uint256 stETHAmount = getStETHByCstETH(_cstETHAmount);
        _burn(msg.sender, _cstETHAmount);
        stETH.safeTransfer(msg.sender, stETHAmount);
    }

    /**
     * @dev Calculates current exchange ratio that exactly is this contract
     * stETH balance divided by total issued cstETH. Multiplicates it with given
     * amount. Works with usual rounding.
     * @param _stETHAmount amount of stETH
     * @return Returns amount of cstETH with current ratio and given stETH amount
    */
    function getCstETHByStETH(uint256 _stETHAmount) public view returns (uint256) {
        uint256 stEthWrapped = stETH.balanceOf(address(this));
        uint256 cstETHIssued = totalSupply();
        if (stEthWrapped == 0 || cstETHIssued == 0)
            return _stETHAmount;
        return _stETHAmount.mul(cstETHIssued).div(stEthWrapped);
    }

    /**
     * @dev Calculates current exchange ratio that exactly is this contract
     * total issued cstETH divided by stETH balance. Multiplicates it with given
     * amount. Works with usual rounding.
     * @param _cstETHAmount amount of cstETH
     * @return Returns amount of stETH with current ratio and given cstETH amount
    */
    function getStETHByCstETH(uint256 _cstETHAmount) public view returns (uint256) {
        uint256 stEthWrapped = stETH.balanceOf(address(this));
        uint256 cstETHIssued = totalSupply();
        if (stEthWrapped == 0 || cstETHIssued == 0)
            return 0;
        return _cstETHAmount.mul(stEthWrapped).div(cstETHIssued);
    }
}
