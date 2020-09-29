pragma solidity 0.4.24;

import "../DePool.sol";
import "./VaultMock.sol";


/**
  * @dev Only for testing purposes! DePool version with some functions exposed.
  */
contract DePoolMock is DePool {

    function initialize(ISTETH _token) public {
        _setToken(_token);
        initialized();
    }

}
