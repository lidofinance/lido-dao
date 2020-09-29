pragma solidity 0.6.12; // latest available for using OZ

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract CstETH is ERC20, ERC20Burnable {
    constructor() public ERC20("Wrapped Liquid staked DePool Ether", "cstETH") {}
}
