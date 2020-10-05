pragma solidity 0.6.12; // latest available for using OZ

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract CstETH is ERC20, ERC20Burnable {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    ERC20 public stETH;

    constructor(ERC20 _stETH)
        public
        ERC20("Wrapped Liquid staked DePool Ether", "cstETH")
    {
        stETH = _stETH;
    }

    function wrap(uint256 _stETHAmount) public {
        uint256 cstETHAmount = getCstETHByStETH(_stETHAmount);
        _mint(msg.sender, cstETHAmount);
        stETH.safeTransferFrom(msg.sender, address(this), _stETHAmount);
    }

    function unwrap(uint256 _cstETHAmount) public {
        uint256 stETHAmount = getStETHByCstETH(_cstETHAmount);
        _burn(msg.sender, _cstETHAmount);
        stETH.safeTransfer(msg.sender, stETHAmount);
    }

    function getCstETHByStETH(uint256 _stETHAmount) public view returns (uint256) {
        uint256 stEthWrapped = stETH.balanceOf(address(this));
        uint256 cstETHIssued = totalSupply();
        uint256 stETHAmount = (
            (stEthWrapped != 0) ?
            _stETHAmount.mul(cstETHIssued).div(stEthWrapped) :
            _stETHAmount
        );
        return stETHAmount;
    }

    function getStETHByCstETH(uint256 _cstETHAmount) public view returns (uint256) {
        uint256 stEthWrapped = stETH.balanceOf(address(this));
        uint256 cstETHIssued = totalSupply();
        uint256 stETHAmount = (
            (cstETHIssued != 0) ?
            _cstETHAmount.mul(stEthWrapped).div(cstETHIssued) :
            0
        );
        return stETHAmount;
    }
}
