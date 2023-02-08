// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


library Assert {
    error AssertFailed();
    error AssertUintEqualFailed(uint256 actual, uint256 expected);
    error AssertBytes32EqualFailed(bytes32 actual, bytes32 expected);
    error AssertAboveFailed(uint256 shouldBeAbove, uint256 compareTo);
    error AssertAtLeastFailed(uint256 shouldBeAtLeast, uint256 compareTo);
    error AssertArrayFailed(uint256[] actual, uint256[] expected);
    error AssertArrayLengthFailed(uint256 actual, uint256 expected);

    function isTrue(bool value) internal pure {
        if (!value) {
            revert AssertFailed();
        }
    }

    function isFalse(bool value) internal pure {
        if (value) {
            revert AssertFailed();
        }
    }

    function equal(uint256 actual, uint256 expected) internal pure {
        if (actual != expected) {
            revert AssertUintEqualFailed(actual, expected);
        }
    }

    function equal(bytes32 actual, bytes32 expected) internal pure {
        if (actual != expected) {
            revert AssertBytes32EqualFailed(actual, expected);
        }
    }

    function atLeast(uint256 shouldBeAtLeast, uint256 compareTo) internal pure {
        if (shouldBeAtLeast < compareTo) {
            revert AssertAtLeastFailed(shouldBeAtLeast, compareTo);
        }
    }

    function above(uint256 shouldBeAbove, uint256 compareTo) internal pure {
        if (shouldBeAbove <= compareTo) {
            revert AssertAboveFailed(shouldBeAbove, compareTo);
        }
    }

    function array(uint256[] memory actual, uint256[] memory expected) internal pure {
        if (actual.length != expected.length) {
            revert AssertArrayFailed(actual, expected);
        }
        for (uint256 i = 0; i < actual.length; ++i) {
            if (actual[i] != expected[i]) {
                revert AssertArrayFailed(actual, expected);
            }
        }
    }

    function arrayLength(uint256[] memory actual, uint256 expectedLen) internal pure {
        if (actual.length != expectedLen) {
            revert AssertArrayLengthFailed(actual.length, expectedLen);
        }
    }

    function emptyArray(uint256[] memory actual) internal pure {
        arrayLength(actual, 0);
    }
}


function dyn(uint256[1] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](1);
    result[0] = arr[0];
}

function dyn(uint256[2] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](2);
    result[0] = arr[0];
    result[1] = arr[1];
}

function dyn(uint256[3] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](3);
    result[0] = arr[0];
    result[1] = arr[1];
    result[2] = arr[2];
}

function dyn(uint256[4] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](4);
    for (uint256 i = 0; i < 4; ++i) {
        result[i] = arr[i];
    }
}

function dyn(uint256[5] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](5);
    for (uint256 i = 0; i < 5; ++i) {
        result[i] = arr[i];
    }
}

function dyn(uint256[6] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](6);
    for (uint256 i = 0; i < 6; ++i) {
        result[i] = arr[i];
    }
}

function dyn(uint256[7] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](7);
    for (uint256 i = 0; i < 7; ++i) {
        result[i] = arr[i];
    }
}

function dyn(uint256[8] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](8);
    for (uint256 i = 0; i < 8; ++i) {
        result[i] = arr[i];
    }
}

function dyn(uint256[9] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](9);
    for (uint256 i = 0; i < 9; ++i) {
        result[i] = arr[i];
    }
}

function dyn(uint256[10] memory arr) pure returns (uint256[] memory result) {
    result = new uint256[](10);
    for (uint256 i = 0; i < 10; ++i) {
        result[i] = arr[i];
    }
}
