pragma solidity 0.4.24;

import "../interfaces/ILido.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract OracleMock {
    ILido private pool;

    function setPool(address _pool) external {
        pool = ILido(_pool);
    }

    function reportBeacon(uint256 _epochId, uint128 _beaconValidators, uint128 _beaconBalance) external {
        pool.pushBeacon(_beaconValidators, _beaconBalance);
    }
}
