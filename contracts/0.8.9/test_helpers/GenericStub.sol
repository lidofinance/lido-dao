// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

enum LogType {
    LOG0,
    LOG1,
    LOG2,
    LOG3,
    LOG4
}

contract ETHForwarder {
    constructor(address payable _recipient) payable {
        selfdestruct(_recipient);
    }
}

contract GenericStub {
    type MethodID is bytes4;
    type InputHash is bytes32;
    type Topic is bytes32;

    // InputHash private immutable WILDCARD_INPUT_HASH;

    struct Log {
        LogType logType;
        bytes data;
        bytes32 t1;
        bytes32 t2;
        bytes32 t3;
        bytes32 t4;
    }

    struct ETHForward {
        address payable recipient;
        uint256 value;
    }

    struct MethodStub {
        /// @notice msg.data used for call
        bytes input;
        /// @notice abi encoded data to be returned from the method
        bytes output;
        /// @notice events to emit during method execution
        Log[] logs;
        /// @notice optional ETH send on method execution
        ETHForward ethForward;
        /// @notice shall method ends with revert instead of return
        bool isRevert;
        /// @notice index of the state to set as current after stub call
        /// @dev this value is one based
        uint256 nextStateIndexOneBased;
    }

    struct StubState {
        /// @notice list of all stubs (order is not guaranteed)
        MethodStub[] stubs;
        /// @notice indices of stubs increased to 1
        mapping(bytes32 => uint256) indicesByIdOneBased;
    }

    StubState[] private _states;
    uint256 private _currentStateIndexOneBased = 1;

    constructor() {
        _states.push();
    }

    function GenericStub__addStub(MethodStub memory _stub) external {
        StubState storage currentState = _getState(_currentStateIndexOneBased - 1);
        currentState.stubs.push();
        bytes32 stubId = keccak256(_stub.input);
        uint256 newStubIndex = currentState.stubs.length - 1;
        currentState.stubs[newStubIndex].input = _stub.input;
        currentState.stubs[newStubIndex].output = _stub.output;
        currentState.stubs[newStubIndex].ethForward = _stub.ethForward;
        currentState.stubs[newStubIndex].isRevert = _stub.isRevert;
        currentState.stubs[newStubIndex].nextStateIndexOneBased = _stub.nextStateIndexOneBased;

        for(uint256 i = 0; i < _stub.logs.length; ++i) {
            currentState.stubs[newStubIndex].logs.push(_stub.logs[i]);
        }
        currentState.indicesByIdOneBased[stubId] = newStubIndex + 1;
    }

    function GenericStub__addState() external {
        _states.push();
        _currentStateIndexOneBased = _states.length;
    }

    function GenericStub__setState(uint256 _stateIndex) external {
        require(_stateIndex != 0, "INVALID_INDEX");
        if (_stateIndex > _states.length) {
            revert GenericStub__StateIndexOutOfBounds(_stateIndex, _states.length);
        }
        _currentStateIndexOneBased = _stateIndex;
    }


    // function GenericStub__cloneState(uint256 _clonedStateIndex) external {
    //     _states.push(_getState(_clonedStateIndex));
    // }


    fallback() external payable {
        MethodStub memory stub = _getMethodStub();
        _forwardETH(stub.ethForward);
        _logEvents(stub.logs);
        bytes memory output = stub.output;
        uint256 outputLength = output.length;
        if (stub.nextStateIndexOneBased != 0) {
            _currentStateIndexOneBased = stub.nextStateIndexOneBased;
        }
        if (stub.isRevert) {
            assembly { revert(add(output, 32), outputLength) }
        }
        assembly { return(add(output, 32), outputLength) }
    }

    function _logEvents(Log[] memory _logs) internal {
        for (uint256 i = 0; i < _logs.length; ++i) {
            bytes32 t1 = _logs[i].t1;
            bytes32 t2 = _logs[i].t2;
            bytes32 t3 = _logs[i].t3;
            bytes32 t4 = _logs[i].t4;
            bytes memory data = _logs[i].data;
            uint256 dataLength = data.length;
            if (_logs[i].logType == LogType.LOG0) {
                assembly { log0(add(data, 32), dataLength) }
            } else if (_logs[i].logType == LogType.LOG1) {
                assembly { log1(add(data, 32), dataLength, t1) }
            } else if (_logs[i].logType == LogType.LOG2) {
                assembly { log2(add(data, 32), dataLength, t1, t2) }
            } else if (_logs[i].logType == LogType.LOG3) {
                assembly { log3(add(data, 32), dataLength, t1, t2, t3) }
            } else if (_logs[i].logType == LogType.LOG4) {
                assembly { log4(add(data, 32), dataLength, t1, t2, t3, t4) }
            }
        }
    }

    function _forwardETH(ETHForward memory _ethForward) internal {
        if (_ethForward.value == 0) return;
        new ETHForwarder{value: _ethForward.value}(_ethForward.recipient);
        emit GenericStub__ethSent(_ethForward.recipient, _ethForward.value);
    }

    function _getMethodStub() internal view returns (MethodStub memory) {
        StubState storage currentState = _getState(_currentStateIndexOneBased - 1);
        bytes32 methodStubId = keccak256(msg.data);
        bytes32 methodStubWildcardId = keccak256(msg.data[:4]);

        uint256 methodStubIndex = currentState.indicesByIdOneBased[methodStubId];
        uint256 methodStubWildcardIndex = currentState.indicesByIdOneBased[methodStubWildcardId];

        if (methodStubIndex == 0 && methodStubWildcardIndex == 0) {
            revert GenericStub__MethodStubIsNotDefined(msg.data);
        }

        return methodStubIndex != 0
            ? currentState.stubs[methodStubIndex - 1]
            : currentState.stubs[methodStubWildcardIndex - 1];
    }

    function _getState(uint256 _stateIndex) internal view returns (StubState storage) {
        if (_stateIndex >= _states.length) {
            revert GenericStub__StateIndexOutOfBounds(_stateIndex, _states.length);
        }
        return _states[_stateIndex];
    }

    event GenericStub__ethSent(address recipient, uint256 value);

    error GenericStub__StateIndexOutOfBounds(uint256 index, uint256 length);
    error GenericStub__MethodStubIsNotDefined(bytes callData);
    error GenericStub__ETHSendFailed(address recipient, uint256 value);
}