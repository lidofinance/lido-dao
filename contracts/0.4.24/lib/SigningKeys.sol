// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";
import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
// import {MemUtils} from "../../common/lib/MemUtils.sol";

import "hardhat/console.sol";

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

    function getKeyOffset(bytes32 _position, uint256 _nodeOperatorId, uint256 _keyIndex) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(_position, _nodeOperatorId, _keyIndex)));
    }

    function saveKeysSigs(
        bytes32 _position,
        uint256 _nodeOperatorId,
        uint256 _startIndex,
        uint256 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) internal returns (uint256) {
        require(_keysCount > 0 && _startIndex.add(_keysCount - 1) <= UINT64_MAX, "INVALID_KEYS_COUNT");
        require(
            _publicKeys.length == _keysCount.mul(PUBKEY_LENGTH) && _signatures.length == _keysCount.mul(SIGNATURE_LENGTH),
            "LENGTH_MISMATCH"
        );

        uint256 curOffset;
        bool isEmpty;
        bytes memory tmpKey = new bytes(48);

        for (uint256 i; i < _keysCount;) {
            curOffset = _position.getKeyOffset(_nodeOperatorId, _startIndex);
            assembly {
                let _ofs := add(add(_publicKeys, 0x20), mul(i, 48)) //PUBKEY_LENGTH = 48
                let _part1 := mload(_ofs) // bytes 0..31
                let _part2 := mload(add(_ofs, 0x10)) // bytes 16..47
                isEmpty := iszero(or(_part1, _part2))

                /// @dev custom revert error
                // if iszero(or(_part1, _part2)) {
                //     let ptrError := mload(0x40)
                //     mstore(ptrError, shl(224, 0x08c379a0)) // selector of `Error(string)`
                //     mstore(add(ptrError, 4), 0x20) // offset of the abi.encoded `string`
                //     mstore(add(ptrError, 0x24), 9) // error text length
                //     mstore(add(ptrError, 0x44), "EMPTY_KEY") // error text 0x454d5054595f4b4559
                //     revert(ptrError, 0x64) // revert data length is 4 bytes for selector and 3 slots of 0x20 bytes
                // }
                mstore(add(tmpKey, 0x30), _part2) // store 2nd part first
                mstore(add(tmpKey, 0x20), _part1) // store 1st part with overwrite bytes 16-31
            }

            require(!isEmpty, "EMPTY_KEY");
            assembly {
                // store key
                sstore(curOffset, mload(add(tmpKey, 0x20))) // store bytes 0..31
                sstore(add(curOffset, 1), shl(128, mload(add(tmpKey, 0x30)))) // store bytes 32..47
                // store signature
                let _ofs := add(add(_signatures, 0x20), mul(i, 96)) //SIGNATURE_LENGTH = 96
                sstore(add(curOffset, 2), mload(_ofs))
                sstore(add(curOffset, 3), mload(add(_ofs, 0x20)))
                sstore(add(curOffset, 4), mload(add(_ofs, 0x40)))
                i := add(i, 1)
                _startIndex := add(_startIndex, 1)
            }
            emit SigningKeyAdded(_nodeOperatorId, tmpKey);
        }
         return _startIndex;
    }

    function removeKeysSigs(
        bytes32 _position,
        uint256 _nodeOperatorId,
        uint256 _startIndex,
        uint256 _keysCount,
        uint256 _totalKeysCount
    ) internal {
        require(_keysCount > 0 && _startIndex.add(_keysCount) <= _totalKeysCount && _totalKeysCount <= UINT64_MAX, "INVALID_KEYS_COUNT");

        uint256 curOffset;
        uint256 lastOffset;
        uint256 j;
        bytes memory tmpKey = new bytes(48);

        console.log("_nodeOperatorId", _nodeOperatorId);
        console.log("_startIndex", _startIndex);
        console.log("_keysCount", _keysCount);
        console.log("_totalKeysCount", _totalKeysCount);

        for (uint256 i = _startIndex + _keysCount; i > _startIndex;) {
            curOffset = _position.getKeyOffset(_nodeOperatorId, i - 1);
            console.log("curOffset", curOffset);

            assembly {
                // read key
                mstore(add(tmpKey, 0x30), shr(128, sload(add(curOffset, 1)))) // bytes 16..47
                mstore(add(tmpKey, 0x20), sload(curOffset)) // bytes 0..31
            }
            if (i < _totalKeysCount) {
                lastOffset = _position.getKeyOffset(_nodeOperatorId, _totalKeysCount - 1);
                 assembly {
                    // read key
                    mstore(add(tmpKey, 0x30), shr(128, sload(add(lastOffset, 1)))) // bytes 16..47
                    mstore(add(tmpKey, 0x20), sload(lastOffset)) // bytes 0..31
                }
                for (j = 0; j < 5;) {
                    assembly {
                        sstore(add(curOffset, j), sload(add(lastOffset, j)))
                        j := add(j, 1)
                    }
                }
                curOffset = lastOffset;
            }
            for (j = 0; j < 5;) {
                assembly {
                    sstore(add(curOffset, j), 0)
                    j := add(j, 1)
                }
            }

            assembly {
                _totalKeysCount := sub(_totalKeysCount, 1)
                i := sub(i, 1)
            }
            emit SigningKeyRemoved(_nodeOperatorId, tmpKey);
            console.logBytes(tmpKey);
        }
    }

    // function removeUnusedKeySig(bytes32 _position, uint256 _nodeOperatorId, uint256 _index, uint256 _lastIndex)
    //     internal
    //     returns (uint256)
    // {
    //     (bytes memory removedKey,) = _position.loadKeySig(_nodeOperatorId, _index);

    //     if (_index < _lastIndex) {
    //         (bytes memory key, bytes memory signature) = _position.loadKeySig(_nodeOperatorId, _lastIndex);
    //         _position.storeKeySig(_nodeOperatorId, _index, key, signature);
    //     }

    //     _position.deleteKeySig(_nodeOperatorId, _lastIndex);
    //     emit SigningKeyRemoved(_nodeOperatorId, removedKey);

    //     return _lastIndex;
    // }

    // function storeKeySig(
    //     bytes32 _position,
    //     uint256 _nodeOperatorId,
    //     uint256 _keyIndex,
    //     bytes memory _pubkey,
    //     bytes memory _signature
    // ) internal {
    //     // assert(_pubkey.length == PUBKEY_LENGTH);
    //     // assert(_signature.length == SIGNATURE_LENGTH);

    //     // key
    //     uint256 offset = _position.getKeyOffset(_nodeOperatorId, _keyIndex);
    //     uint256 keyExcessBits = (2 * 32 - PUBKEY_LENGTH) * 8;
    //     assembly {
    //         sstore(offset, mload(add(_pubkey, 0x20)))
    //         sstore(add(offset, 1), shl(keyExcessBits, shr(keyExcessBits, mload(add(_pubkey, 0x40)))))
    //     }
    //     offset += 2;

    //     // signature
    //     for (uint256 i = 0; i < SIGNATURE_LENGTH; i += 32) {
    //         assembly {
    //             sstore(offset, mload(add(_signature, add(0x20, i))))
    //         }
    //         offset++;
    //     }
    // }

    // function deleteKeySig(bytes32 _position, uint256 _nodeOperatorId, uint256 _keyIndex) internal {
    //     uint256 offset = _position.getKeyOffset(_nodeOperatorId, _keyIndex);
    //     for (uint256 i = 0; i < (PUBKEY_LENGTH + SIGNATURE_LENGTH) / 32 + 1; ++i) {
    //         assembly {
    //             sstore(add(offset, i), 0)
    //         }
    //     }
    // }

    function loadKeysSigs(
        bytes32 _position,
        uint256 _nodeOperatorId,
        uint256 _startIndex,
        uint256 _keysCount,
        bytes memory _pubkeys,
        bytes memory _signatures,
        uint256 _bufOffset // key offset inside _pubkeys/_signatures buffers
    ) internal view {
        uint256 curOffset;
        for (uint256 i; i < _keysCount;) {
            curOffset = _position.getKeyOffset(_nodeOperatorId, _startIndex + i);
            assembly {
                // read key
                let _ofs := add(add(_pubkeys, 0x20), mul(add(_bufOffset, i), 48)) //PUBKEY_LENGTH = 48
                mstore(add(_ofs, 0x10), shr(128, sload(add(curOffset, 1)))) // bytes 16..47
                mstore(_ofs, sload(curOffset)) // bytes 0..31
                // store signature
                _ofs := add(add(_signatures, 0x20), mul(add(_bufOffset, i), 96)) //SIGNATURE_LENGTH = 96
                mstore(_ofs, sload(add(curOffset, 2)))
                mstore(add(_ofs, 0x20), sload(add(curOffset, 3)))
                mstore(add(_ofs, 0x40), sload(add(curOffset, 4)))
                i := add(i, 1)
            }
        }
    }

    // function loadKeySig(bytes32 _position, uint256 _nodeOperatorId, uint256 _keyIndex)
    //     internal
    //     view
    //     returns (bytes memory pubkey, bytes memory signature)
    // {
    //     uint256 offset = _position.getKeyOffset(_nodeOperatorId, _keyIndex);

    //     // key
    //     bytes memory tmpKey = MemUtils.unsafeAllocateBytes(64);
    //     assembly {
    //         mstore(add(tmpKey, 0x20), sload(offset))
    //         mstore(add(tmpKey, 0x40), sload(add(offset, 1)))
    //     }
    //     offset += 2;
    //     pubkey = MemUtils.unsafeAllocateBytes(PUBKEY_LENGTH);
    //     MemUtils.copyBytes(tmpKey, pubkey, 0, 0, PUBKEY_LENGTH);
    //     // signature
    //     signature = MemUtils.unsafeAllocateBytes(SIGNATURE_LENGTH);
    //     for (uint256 i = 0; i < SIGNATURE_LENGTH; i += 32) {
    //         assembly {
    //             mstore(add(signature, add(0x20, i)), sload(offset))
    //         }
    //         offset++;
    //     }
    // }

    function initKeysSigsBuf(uint256 _count) internal pure returns (bytes memory, bytes memory) {
        return (
            new bytes(_count.mul(PUBKEY_LENGTH)), new bytes(_count.mul(SIGNATURE_LENGTH))
            // MemUtils.unsafeAllocateBytes(_count.mul(PUBKEY_LENGTH)), MemUtils.unsafeAllocateBytes(_count.mul(SIGNATURE_LENGTH))
        );
    }
}
