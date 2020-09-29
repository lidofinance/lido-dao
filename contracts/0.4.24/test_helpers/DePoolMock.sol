pragma solidity 0.4.24;

import "../DePool.sol";
import "./VaultMock.sol";


/**
  * @dev Only for testing purposes! DePool version with some functions exposed.
  */
contract DePoolMock is DePool {

  uint256 private totalControlledEther;

  function initialize(ISTETH _token) public {
    _setToken(_token);
    initialized();
  }

  function setTotalControlledEther(uint256 _totalControlledEther) public {
    totalControlledEther = _totalControlledEther;
  }

  function getTotalControlledEther() external view returns (uint256) {
    return totalControlledEther;
  }

}
