// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";
import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
import {MemUtils} from "../../common/lib/MemUtils.sol";

library SigningKeys {
    using SafeMath for uint256;
    using SafeMath64 for uint64;

    using SigningKeys for bytes32;

    uint64 internal constant PUBKEY_LENGTH = 48;
    uint64 internal constant SIGNATURE_LENGTH = 96;
    uint256 internal constant UINT64_MAX = uint256(~uint64(0));

    event SigningKeyAdded(uint256 indexed nodeOperatorId, bytes pubkey);
    event SigningKeyRemoved(uint256 indexed nodeOperatorId, bytes pubkey);

    function isKeyEmpty(bytes memory _key) internal pure returns (bool) {
        assert(_key.length == PUBKEY_LENGTH);

        uint256 k1;
        uint256 k2;
        assembly {
            k1 := mload(add(_key, 0x20))
            k2 := mload(add(_key, 0x40))
        }

        return 0 == k1 && 0 == (k2 >> ((2 * 32 - PUBKEY_LENGTH) * 8));
    }

    function getKeyOffset(bytes32 _position, uint256 _nodeOperatorId, uint256 _keyIndex)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encodePacked(_position, _nodeOperatorId, _keyIndex)));
    }

    function addKeysSigs(
        bytes32 _position,
        uint256 _nodeOperatorId,
        uint256 _keysCount,
        uint256 _startIndex,
        bytes _publicKeys,
        bytes _signatures
    ) internal returns (uint256) {
        require(_keysCount != 0, "NO_KEYS");
        require(_keysCount <= UINT64_MAX, "KEYS_COUNT_TOO_LARGE");
        require(_publicKeys.length == _keysCount.mul(PUBKEY_LENGTH), "INVALID_LENGTH");
        require(_signatures.length == _keysCount.mul(SIGNATURE_LENGTH), "INVALID_LENGTH");

        (bytes memory key, bytes memory sig) = initKeySig(1);
        for (uint256 i = 0; i < _keysCount; ++i) {
            MemUtils.copyBytes(_publicKeys, key, i * PUBKEY_LENGTH, 0, PUBKEY_LENGTH);
            require(!isKeyEmpty(key), "EMPTY_KEY");
            MemUtils.copyBytes(_signatures, sig, i * SIGNATURE_LENGTH, 0, SIGNATURE_LENGTH);

            _position.storeKeySig(_nodeOperatorId, _startIndex, key, sig);
            _startIndex = _startIndex.add(1);
            emit SigningKeyAdded(_nodeOperatorId, key);
        }
        return _startIndex;
    }

    function removeUnusedKeySig(bytes32 _position, uint256 _nodeOperatorId, uint256 _index, uint256 _lastIndex)
        internal
        returns (uint256)
    {
        (bytes memory removedKey,) = _position.loadKeySig(_nodeOperatorId, _index);

        if (_index < _lastIndex) {
            (bytes memory key, bytes memory signature) = _position.loadKeySig(_nodeOperatorId, _lastIndex);
            _position.storeKeySig(_nodeOperatorId, _index, key, signature);
        }

        _position.deleteKeySig(_nodeOperatorId, _lastIndex);
        emit SigningKeyRemoved(_nodeOperatorId, removedKey);

        return _lastIndex;
    }

    function storeKeySig(
        bytes32 _position,
        uint256 _nodeOperatorId,
        uint256 _keyIndex,
        bytes memory _pubkey,
        bytes memory _signature
    ) internal {
        // assert(_pubkey.length == PUBKEY_LENGTH);
        // assert(_signature.length == SIGNATURE_LENGTH);

        // key
        uint256 offset = _position.getKeyOffset(_nodeOperatorId, _keyIndex);
        uint256 keyExcessBits = (2 * 32 - PUBKEY_LENGTH) * 8;
        assembly {
            sstore(offset, mload(add(_pubkey, 0x20)))
            sstore(add(offset, 1), shl(keyExcessBits, shr(keyExcessBits, mload(add(_pubkey, 0x40)))))
        }
        offset += 2;

        // signature
        for (uint256 i = 0; i < SIGNATURE_LENGTH; i += 32) {
            assembly {
                sstore(offset, mload(add(_signature, add(0x20, i))))
            }
            offset++;
        }
    }

    function deleteKeySig(bytes32 _position, uint256 _nodeOperatorId, uint256 _keyIndex) internal {
        uint256 offset = _position.getKeyOffset(_nodeOperatorId, _keyIndex);
        for (uint256 i = 0; i < (PUBKEY_LENGTH + SIGNATURE_LENGTH) / 32 + 1; ++i) {
            assembly {
                sstore(add(offset, i), 0)
            }
        }
    }

    function loadKeySigAndAppend(
        bytes32 _position,
        uint256 _nodeOperatorId,
        uint256 _keyIndex,
        uint256 _offset,
        bytes memory _pubkeys,
        bytes memory _signatures
    ) internal view {
        (bytes memory pubkey, bytes memory signature) = _position.loadKeySig(_nodeOperatorId, _keyIndex);
        MemUtils.copyBytes(pubkey, _pubkeys, _offset.mul(PUBKEY_LENGTH));
        MemUtils.copyBytes(signature, _signatures, _offset.mul(SIGNATURE_LENGTH));
    }

    function loadKeySig(bytes32 _position, uint256 _nodeOperatorId, uint256 _keyIndex)
        internal
        view
        returns (bytes memory pubkey, bytes memory signature)
    {
        uint256 offset = _position.getKeyOffset(_nodeOperatorId, _keyIndex);

        // key
        bytes memory tmpKey = MemUtils.unsafeAllocateBytes(64);
        assembly {
            mstore(add(tmpKey, 0x20), sload(offset))
            mstore(add(tmpKey, 0x40), sload(add(offset, 1)))
        }
        offset += 2;
        pubkey = MemUtils.unsafeAllocateBytes(PUBKEY_LENGTH);
        MemUtils.copyBytes(tmpKey, pubkey, 0, 0, PUBKEY_LENGTH);
        // signature
        signature = MemUtils.unsafeAllocateBytes(SIGNATURE_LENGTH);
        for (uint256 i = 0; i < SIGNATURE_LENGTH; i += 32) {
            assembly {
                mstore(add(signature, add(0x20, i)), sload(offset))
            }
            offset++;
        }
    }

    function initKeySig(uint256 _count) internal pure returns (bytes memory, bytes memory) {
        return (
            MemUtils.unsafeAllocateBytes(_count.mul(PUBKEY_LENGTH)),
            MemUtils.unsafeAllocateBytes(_count.mul(SIGNATURE_LENGTH))
        );
    }
}
