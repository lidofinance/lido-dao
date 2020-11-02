pragma solidity 0.4.24;

import "@aragon/os/contracts/lib/math/SafeMath.sol";


library Algorithm {
    using SafeMath for uint256;

    /**
      * Computes mode of a non-empty array, if array is unimodal.
      * Low gas cost.
      */
    function mode(uint256[] data) internal pure returns (bool, uint256) {

        assert(0 != data.length);

        // allocate arrays
        uint256[] memory dataValues = new uint256[](data.length);
        uint256[] memory dataValuesCounts = new uint256[](data.length);

        // initialize first element
        dataValues[0] = data[0];
        dataValuesCounts[0] = 1;
        uint256 dataValuesLength = 1;

        // process data
        uint256 i = 0;
        uint256 j = 0;
        bool complete;
        for (i = 1; i < data.length; i++) {
            complete = true;
            for (j = 0; j < dataValuesLength; j++) {
                if (data[i] == dataValues[j]) {
                    dataValuesCounts[j]++;
                    complete = false;
                    break;
                }
            }
            if (complete) {
                dataValues[dataValuesLength] = data[i];
                dataValuesCounts[dataValuesLength]++;
                dataValuesLength++;
            }
        }

        // find mode value index
        uint256 mostFrequentValueIndex = 0;
        for (i = 1; i < dataValuesLength; i++) {
            if (dataValuesCounts[i] > dataValuesCounts[mostFrequentValueIndex])
                mostFrequentValueIndex = i;
        }

        // check if data is unimodal
        for (i = 0; i < dataValuesLength; i++) {
            if ((i != mostFrequentValueIndex) && (dataValuesCounts[i] == dataValuesCounts[mostFrequentValueIndex]))
                return (false, 0);
        }

        return (true, dataValues[mostFrequentValueIndex]);
    }
}
