pragma solidity 0.6.12; // latest available for using OZ

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract StETHMock is ERC20, ERC20Burnable {
    constructor() public ERC20("Liquid staked DePool Ether", "StETH") {}

    uint256 public totalShares;
    uint256 public totalControlledEther;

    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }

    function setTotalShares(uint256 _totalShares) public {
        totalShares = _totalShares;
    }

    function setTotalControlledEther(uint256 _totalControlledEther) public {
        totalControlledEther = _totalControlledEther;
    }

    function getPooledEthByShares(uint256 _sharesAmount) public view returns (uint256) {
        if (totalShares == 0)
            return 0;
        return _sharesAmount.mul(totalControlledEther).div(totalShares);
    }

    function getSharesByPooledEth(uint256 _pooledEthAmount) public view returns (uint256) {
        if (totalControlledEther == 0)
            return 0;
        return _pooledEthAmount.mul(totalShares).div(totalControlledEther);
    }
}
