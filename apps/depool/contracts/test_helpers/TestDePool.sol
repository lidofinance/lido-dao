pragma solidity 0.4.24;

import "../DePool.sol";


/**
  * @dev Only for testing purposes! DePool version with some functions exposed.
  */
contract TestDePool is DePool {
    /**
      * @dev Gets unaccounted (excess) Ether on this contract balance
      */
    function getUnaccountedEther() public view returns (uint256) {
        return _getUnaccountedEther();
    }

    /**
      * @dev Fast dynamic array comparison
      */
    function isEqual(bytes memory _a, bytes memory _b) public pure returns (bool) {
        return _isEqual(_a, _b);
    }

    /**
      * @dev Padding memory array with zeroes up to 64 bytes
      * @param _b Memory array of size 32 .. 64
      */
    function pad64(bytes memory _b) public pure returns (bytes memory) {
        return _pad64(_b);
    }

    /**
      * @dev Converting value to little endian bytes
      * @param _value Number less than `2**64` for compatibility reasons
      */
    function toLittleEndian64(uint256 _value) public pure returns (uint256 result) {
        return _toLittleEndian64(_value);
    }
}
