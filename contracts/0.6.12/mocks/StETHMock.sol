pragma solidity 0.6.12; // latest available for using OZ

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract StETHMock is ERC20, ERC20Burnable {
    constructor() public ERC20("Liquid staked DePool Ether", "StETH") {}

    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }
}
