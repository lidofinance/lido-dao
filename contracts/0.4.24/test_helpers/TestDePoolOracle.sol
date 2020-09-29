pragma solidity 0.4.24;

import "../oracle/DePoolOracle.sol";


/**
  * @dev Only for testing purposes! DePoolOracle version with some functions exposed.
  */
contract TestDePoolOracle is DePoolOracle {
    uint256 private time;

    function setTime(uint256 _time) public {
        time = _time;
    }

    function _getTime() internal view returns (uint256) {
        return time;
    }
}
