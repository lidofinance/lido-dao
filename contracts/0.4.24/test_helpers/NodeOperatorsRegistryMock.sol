// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import '../nos/NodeOperatorsRegistry.sol';

contract NodeOperatorsRegistryMock is NodeOperatorsRegistry {
    function setTotalKeys(uint256 _keys) external {
        TOTAL_KEYS_POSITION.setStorageUint256(_keys);
    }

    function setTotalUsedKeys(uint256 _keys) external {
        TOTAL_USED_KEYS_POSITION.setStorageUint256(_keys);
    }

    function setUsedKeys(uint256 _operatorId, uint64 _keys) external {
        operators[_operatorId].usedSigningKeys = _keys;
    }

    function setTotalStoppedKeys(uint256 _keys) external {
        TOTAL_STOPPED_KEYS_POSITION.setStorageUint256(_keys);
    }
}
