pragma solidity 0.6.12; // latest available for using OZ

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract CstETH is ERC20, ERC20Burnable {
    ERC20 public stETH;
    using SafeERC20 for ERC20;

    constructor(ERC20 _stETH)
        public
        ERC20("Wrapped Liquid staked DePool Ether", "cstETH")
    {
        stETH = _stETH;
    }

    function wrap(address _to, uint256 _stETHAmount) public {
        uint256 cstETHAmount = _stETHAmount; // 1:1 ratio
        _mint(_to, cstETHAmount);
        stETH.safeTransferFrom(msg.sender, address(this), _stETHAmount);
    }

    function unwrap(address _to, uint256 _cstETHAmount) public {
        _burn(msg.sender, _cstETHAmount);
        uint256 stETHAmount = _cstETHAmount; // 1:1 ratio
        stETH.safeTransfer(_to, stETHAmount);
    }
}
