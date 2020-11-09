pragma solidity 0.4.24;

import "@aragon/os/contracts/common/UnstructuredStorage.sol";


contract Pausable {
    using UnstructuredStorage for bytes32;

    event Stopped();
    event Resumed();

    bytes32 internal constant STOPPED_FLAG_POSITION = keccak256("lido.Pausable.stopped");

    modifier whenNotStopped() {
        require(!STOPPED_FLAG_POSITION.getStorageBool(), "CONTRACT_IS_STOPPED");
        _;
    }

    modifier whenStopped() {
        require(STOPPED_FLAG_POSITION.getStorageBool());
        _;
    }

    function isStopped() external view returns (bool) {
        return STOPPED_FLAG_POSITION.getStorageBool();
    }

    function _stop() internal whenNotStopped {
        STOPPED_FLAG_POSITION.setStorageBool(true);
        emit Stopped();
    }

    function _resume() internal whenStopped {
        STOPPED_FLAG_POSITION.setStorageBool(false);
        emit Resumed();
    }
}
