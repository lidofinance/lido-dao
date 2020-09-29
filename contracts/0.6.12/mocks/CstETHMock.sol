pragma solidity 0.6.12; // latest available for using OZ

import "../CstETH.sol";

contract CstETHMock is CstETH {
    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }
}
