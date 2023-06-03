// SPDX-License-Identifier: MIT
pragma solidity >=0.4.24 <0.9.0;

import "forge-std/Test.sol";
import {ECDSA} from "contracts/common/lib/ECDSA.sol";
import { SignatureUtils } from "contracts/common/lib/SignatureUtils.sol";

contract ExposedSignatureUtils {
    function _isValidSignature(
        address signer,
        bytes32 msgHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public returns (bool) {
        return SignatureUtils.isValidSignature(signer, msgHash, v, r, s);
    }

    function hasCode(address addr) public returns (bool) {
        return SignatureUtils._hasCode(addr);
    }
}

contract SignatureUtilsTest is Test {
    ExposedSignatureUtils public sigUtil;

    function ethMessageHash(string memory message) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", message)
        );
    }

    function setUp() public {
        sigUtil = new ExposedSignatureUtils();
    }

    function testHasCodeFalse() public {
        address eoa = 0xbeFA429d57cD18b7F8A4d91A2da9AB4AF05d0FBe;
        address con = address(new ExposedSignatureUtils());

        assertEq(sigUtil.hasCode(eoa), false);
        assertEq(sigUtil.hasCode(con), true);
    }

    function testEoaIsValidSignature() public { 
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        assertEq(sigUtil._isValidSignature(eoa, hash, v, r, s), true);
    }

    function testIsValidSignatureFuzzMessage(bytes memory data) public { 
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256(data);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Regardless of the message, it should always validate
        assertEq(sigUtil._isValidSignature(eoa, hash, v, r, s), true);
    }

    function testIsValidSignatureFuzzV(uint8 _v) public { 
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Test to see if we can get valid signatures without a valid V
        if (v == _v) {
            assertEq(sigUtil._isValidSignature(eoa, hash, _v, r, s), true);
        } else if (27 == _v) {
            assertEq(sigUtil._isValidSignature(eoa, hash, _v, r, s), false);
        } else {
            vm.expectRevert(bytes("ECDSA: invalid signature"));
            sigUtil._isValidSignature(eoa, hash, _v, r, s);
        }
    }

    function testIsValidSignatureFuzzR(bytes32 _r) public { 
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Test to see if we can get valid signatures regardless of what R is
        if (r == _r) {
            assertEq(sigUtil._isValidSignature(eoa, hash, v, _r, s), true);
        }
    }

    function testIsValidSignatureFuzzS(bytes32 _s) public { 
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Test to see if we can get valid signatures regardless of what S is
        if (s == _s) {
            assertEq(sigUtil._isValidSignature(eoa, hash, v, r, _s), true);
        } 
    }

    function testIsValidSignatureWrongSigner(uint256 rogueSigner) public { 
        // Ignore the 0 case for rogue signer
        vm.assume(rogueSigner != 0);

        // Ignore signers above secp256k1 curve order
        vm.assume(rogueSigner < 115792089237316195423570985008687907852837564279074904382605163141518161494337);

        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        address eoa2 = vm.addr(rogueSigner);

        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        if (eoa == eoa2) {
            assertEq(sigUtil._isValidSignature(eoa2, hash, v, r, s), true);
        } else {
            assertEq(sigUtil._isValidSignature(eoa2, hash, v, r, s), false);
        }
    }
}