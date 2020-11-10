pragma solidity 0.4.24;

import "../interfaces/ILido.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract OracleMock {
    ILido private pool;

    function initialize(address _pool) external {
        pool = ILido(_pool);
    }

    function reportEther2(uint256 _epoch, uint256 _eth2balance) external {
        pool.reportEther2(_epoch, _eth2balance);
    }
}
