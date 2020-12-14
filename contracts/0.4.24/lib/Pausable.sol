// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "@aragon/os/contracts/common/UnstructuredStorage.sol";


contract Pausable {
    using UnstructuredStorage for bytes32;

    event Stopped();
    event Resumed();

    bytes32 internal constant RUNNING_FLAG_POSITION = keccak256("lido.Pausable.running");

    modifier whenNotStopped() {
        require(RUNNING_FLAG_POSITION.getStorageBool(), "CONTRACT_IS_STOPPED");
        _;
    }

    modifier whenStopped() {
        require(!RUNNING_FLAG_POSITION.getStorageBool());
        _;
    }

    function isStopped() external view returns (bool) {
        return !RUNNING_FLAG_POSITION.getStorageBool();
    }

    function _stop() internal whenNotStopped {
        RUNNING_FLAG_POSITION.setStorageBool(false);
        emit Stopped();
    }

    function _resume() internal whenStopped {
        RUNNING_FLAG_POSITION.setStorageBool(true);
        emit Resumed();
    }
}
