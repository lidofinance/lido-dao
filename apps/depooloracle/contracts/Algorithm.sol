pragma solidity 0.4.24;

import "@aragon/os/contracts/lib/math/SafeMath.sol";


library Algorithm {
    using SafeMath for uint256;

    /**
      * Computes a median of a non-empty array, modifying it in process (!)
      */
    function modifyingMedian(uint256[] data) internal returns (uint256) {
        // TODO quickselect with Hoare partition scheme

        assert(0 != data.length);
        sort(data);

        if (data.length % 2 == 1) {
            return data[data.length.div(2)];
        } else {
            return data[data.length.div(2)].add(data[data.length.div(2).sub(1)]).div(2);
        }
    }

    /**
      * Computes a mode of a non-empty array, modifying it in process (!)
      */
    function modifyingMode(uint256[] data) internal returns (uint256) {

        assert(0 != data.length);
        sort(data);

        // linear traversal algorithm
        uint256 result = data[0];
        uint256 max_count = 1;
        uint256 cur_count = 1;

        for (uint256 i = 1; i < data.length; i++) {
            if (data[i] == data[i - 1])
                cur_count++;
            else {
                if (cur_count > max_count) {
                    max_count = cur_count;
                    result = data[i - 1];
                }
                cur_count = 1;
            }
        }

        if (cur_count > max_count)
        {
            max_count = cur_count;
            result = data[data.length - 1];
        }

        return result;
    }

    /**
      * Sorts an array in-place
      */
    function sort(uint256[] data) internal {
        // Based on https://ethereum.stackexchange.com/a/1518
        if (0 == data.length)
            return;

        _quickSort(data, 0, data.length.sub(1));
    }

    function _quickSort(uint256[] memory arr, uint256 left, uint256 right) internal {
        // Based on https://ethereum.stackexchange.com/a/1518
        uint256 i = left;
        uint256 j = right;
        if (i == j)
            return;

        uint256 pivot = arr[left.add(right.sub(left).div(2))];
        while (i <= j) {
            while (arr[i] < pivot)
                i = i.add(1);

            while (arr[j] > pivot)
                j = j.sub(1);

            if (i <= j) {
                (arr[i], arr[j]) = (arr[j], arr[i]);
                i = i.add(1);
                if (0 == j)
                    break;
                j = j.sub(1);
            }
        }

        if (left < j)
            _quickSort(arr, left, j);
        if (i < right)
            _quickSort(arr, i, right);
    }
}
