// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import { BytesLib } from "./BytesLib.sol";


library BatchedSigningKeys {
    uint256 private constant PUBLIC_KEY_LENGTH = 48;
    uint256 private constant SIGNATURE_LENGTH = 96;

    function validatePublicKeysBatch(bytes memory publicKeysBatch, uint256 keysCount) internal pure {
        require(publicKeysBatch.length == PUBLIC_KEY_LENGTH * keysCount, "INVALID_PUBLIC_KEYS_BATCH_LENGTH");
    }

    function validateSignaturesBatch(bytes memory signaturesBatch, uint256 keysCount) internal pure {
        require(signaturesBatch.length == SIGNATURE_LENGTH * keysCount, "INVALID_SIGNATURES_BATCH_LENGTH");
    }

    function readPublicKey(bytes memory pubkeys, uint256 offset) internal pure returns (bytes memory pubkey) {
        return BytesLib.slice(pubkeys, offset * PUBLIC_KEY_LENGTH, PUBLIC_KEY_LENGTH);
    }

    function readSignature(bytes memory signatures, uint256 offset) internal pure returns (bytes memory signature) {
        return BytesLib.slice(signatures, offset * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
    }
}
