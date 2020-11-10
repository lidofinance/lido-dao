pragma solidity 0.4.24;

import "../Lido.sol";
import "./VaultMock.sol";


/**
 * @dev Only for testing purposes! Lido version with some functions exposed.
 */
contract LidoMock is Lido {
    function getTotalControlledEther() external view returns (uint256) {
        return totalControlledEther;
    }

    function initialize(ISTETH _token) public {
        _setToken(_token);
        initialized();
    }

    function setTotalControlledEther(uint256 _totalControlledEther) public {
        totalControlledEther = _totalControlledEther;
    }
    
    uint256 private totalControlledEther;
}
