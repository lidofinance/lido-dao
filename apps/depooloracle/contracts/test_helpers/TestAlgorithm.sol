pragma solidity 0.4.24;

import "../Algorithm.sol";

contract TestAlgorithm {
    function modifyingModeTest(uint256[] data) public returns (uint256 mode) {
        return Algorithm.modifyingMode(data);
    }

    function modeTest(uint256[] data) public pure returns (bool isUnimodal, uint256 mode) {
        return Algorithm.mode(data);
    }
}
