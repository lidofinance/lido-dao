pragma solidity 0.4.24;

import "../Algorithm.sol";

contract TestAlgorithm {
    function modeTest(uint256[] data) public pure returns (bool isUnimodal, uint256 mode) {
        return Algorithm.mode(data);
    }
}
