// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


library BitOps {
    /**
      * @dev Gets n-th bit in a bitmask
      */
    function getBit(uint256 _mask, uint256 _bitIndex) internal pure returns (bool) {
        require(_bitIndex < 256);
        return 0 != (_mask & (1 << _bitIndex));
    }

    /**
      * @dev Sets n-th bit in a bitmask
      */
    function setBit(uint256 _mask, uint256 _bitIndex, bool bit) internal pure returns (uint256) {
        require(_bitIndex < 256);
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
        uint256 tmp_mask = _mask;
        for (uint256 i = 0; i < 256; ++i) {
            if (1 == tmp_mask & 1) {
                result++;
            }
            tmp_mask >>= 1;
        }

        assert(0 == tmp_mask);
        return result;
    }
}
