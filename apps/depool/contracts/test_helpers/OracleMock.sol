pragma solidity 0.4.24;

import "@depools/dao/contracts/interfaces/IDePool.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract OracleMock {
    IDePool private pool;

    function setPool(address _pool) external {
        pool = IDePool(_pool);
    }

    function reportEther2(uint256 _epoch, uint256 _eth2balance) external {
        pool.reportEther2(_epoch, _eth2balance);
    }
}
