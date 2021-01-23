// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "@aragon/os/contracts/lib/math/SafeMath.sol";


library Algorithm {
    using SafeMath for uint256;

    /**
      * @dev Finds the first element in the given array |data| that occures
      * more that |quorum| times. Low gas cost for majority case. Returns the
      * discovered element or 0 if no element is frequent enough.
      */
    function frequent(uint256[] data, uint256 quorum) internal pure returns (uint256) {
        assert(0 != data.length);

        uint256 acc = 0;
        uint256 ctr = 0;
        uint256 i;
        if (quorum * 2 > data.length) {
            
            // If the expected quorum is more then half of data length, apply
            // Boyer–Moore majority vote algorithm
            for (i = 0; i < data.length; ++i) {
                if (ctr == 0) {
                    acc = data[i];
                    ++ctr;
                } else if (acc == data[i]) {
                    if (++ctr == quorum) return acc;
                } else {
                    --ctr;
                }
            }

            // And make sure the resulted element is frequent enough
            ctr = 0;
            for (i = 0; i < data.length; ++i) {
                if (data[i] == acc && ++ctr == quorum) return acc;
            }
        } else {
            
            // Otherwise, apply optimized insertion sort
            uint256 j;
            uint256 cur;
            for (i = 1; i < data.length; ++i) {
                j = i - 1;
                cur = data[i];
                while (j >= 0 && data[j] > cur) {
                    data[j + 1] = data[j];
                    --j;
                }
                data[j + 1] = cur;
            }

            // And locate the first element that is frequent enough
            for (i = 0; i < data.length; ++i) {
                if (acc == data[i]) {
                    if (++ctr == quorum) return acc;
                } else {
                    acc = data[i];
                    ctr = 1;
                }
            }
        }

        return 0;
    }
}
