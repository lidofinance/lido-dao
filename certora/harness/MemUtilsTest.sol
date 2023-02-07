// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {MemUtils} from "../../contracts/common/lib/MemUtils.sol";

contract MemUtilsTest {

    uint256 internal constant PUBLIC_KEY_LENGTH = 48;
    uint256 internal constant SIGNATURE_LENGTH = 96;
    uint256 internal _keysCount;

    function setKeysCount(uint256 keysCount) public {
        _keysCount = keysCount;
    }

    /**
    * @notice Certora helper: get a single word out of bytes at some offset.   
    * @param self The byte string to read a word from.
    * @param offset the offset to read the word at.
    * @return word The bytes32 word at the offset.
    */ 
    function readWordAtOffset(bytes memory self, uint256 offset) internal pure returns(bytes32 word) {
        assembly {
            word := mload(add(add(self, 32), offset))
        }
    }

    function threeWordInput(uint256 a, uint256 b, uint256 c) public pure returns (bytes memory) {
        return abi.encodePacked(a,b,c);
    }

    function test1(uint256 a, uint256 b, uint256 c) public pure returns (uint256, uint256, uint256) {
        bytes memory input = threeWordInput(a, b, c);
        bytes memory output = testCode1(input);
        return (
            uint256(readWordAtOffset(output, 0)),
            uint256(readWordAtOffset(output, 32)),
            uint256(readWordAtOffset(output, 64))
            );
    }

    
    function testCode1(bytes memory _signature) internal pure returns (bytes memory) {
        bytes memory sigPart1 = MemUtils.unsafeAllocateBytes(64);
        bytes memory sigPart2 = MemUtils.unsafeAllocateBytes(SIGNATURE_LENGTH - 64);
        MemUtils.copyBytes(_signature, sigPart1, 0, 0, 64);
        MemUtils.copyBytes(_signature, sigPart2, 64, 0,SIGNATURE_LENGTH - 64);
        return sigPart1;
    }

    function testCode2(bytes memory _publicKeysBatch, bytes memory _signaturesBatch) internal view {
        bytes memory publicKey = MemUtils.unsafeAllocateBytes(PUBLIC_KEY_LENGTH);
        bytes memory signature = MemUtils.unsafeAllocateBytes(SIGNATURE_LENGTH);

        for (uint256 i; i < _keysCount;) {
            MemUtils.copyBytes(_publicKeysBatch, publicKey, i * PUBLIC_KEY_LENGTH, 0, PUBLIC_KEY_LENGTH);
            MemUtils.copyBytes(_signaturesBatch, signature, i * SIGNATURE_LENGTH, 0, SIGNATURE_LENGTH);

            unchecked {
                ++i;
            }
        }
    }
    
}
