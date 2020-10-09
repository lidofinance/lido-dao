pragma solidity 0.4.24;


library BitOps {
    /**
      * @dev Gets n-th bit in a bitmask
      */
    function getBit(uint256 _mask, uint256 _bitIndex) internal pure returns (bool) {
        return 0 != (_mask & (1 << _bitIndex));
    }

    /**
      * @dev Sets n-th bit in a bitmask
      */
    function setBit(uint256 _mask, uint256 _bitIndex, bool bit) internal pure returns (uint256) {
        if (bit) {
            return _mask | (1 << _bitIndex);
        } else {
            return _mask & (~(1 << _bitIndex));
        }
    }

    /**
      * @dev Returns a population count - number of bits set in a number
      */
    function popcnt(uint256 _mask) internal pure returns (uint256) {
        uint256 result = 0;
        for (uint256 i = 0; i < 256; ++i) {
            if (1 == _mask & 1) {
                result++;
            }
            _mask >>= 1;
        }

        assert(0 == _mask);
        return result;
    }
}
