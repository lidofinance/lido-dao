// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "@aragon/os/contracts/common/UnstructuredStorage.sol";


contract Pausable {
    using UnstructuredStorage for bytes32;

    event Stopped();
    event Resumed();

    bytes32 internal constant ACTIVE_FLAG_POSITION = keccak256("lido.Pausable.activeFlag");

    function _whenNotStopped() internal view {
        require(ACTIVE_FLAG_POSITION.getStorageBool(), "CONTRACT_IS_STOPPED");
    }

    function _whenStopped() internal view {
        require(!ACTIVE_FLAG_POSITION.getStorageBool(), "CONTRACT_IS_ACTIVE");
    }

    function isStopped() public view returns (bool) {
        return !ACTIVE_FLAG_POSITION.getStorageBool();
    }

    function _stop() internal {
        _whenNotStopped();

        ACTIVE_FLAG_POSITION.setStorageBool(false);
        emit Stopped();
    }

    function _resume() internal {
        _whenStopped();

        ACTIVE_FLAG_POSITION.setStorageBool(true);
        emit Resumed();
    }
}
