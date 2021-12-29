// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

/**
  * @title Interface defining a callback that the quorum will call on every quorum reached
  */
interface IBeaconReportReceiver {
    /**
      * @notice Callback to be called by the oracle contract upon the quorum is reached
      * @param _postTotalPooledEther total pooled ether on Lido right after the quorum value was reported
      * @param _preTotalPooledEther total pooled ether on Lido right before the quorum value was reported
      * @param _timeElapsed time elapsed in seconds between the last and the previous quorum
      */
    function processLidoOracleReport(uint256 _postTotalPooledEther,
                                     uint256 _preTotalPooledEther,
                                     uint256 _timeElapsed) external;
}

contract CompositeBeaconReceiver is IBeaconReportReceiver {
    address public immutable VOTING;
    address public immutable ORACLE;

    address[] public beaconReceivers;

    event BeaconReceiverAdded(address indexed beaconReceiver);
    event BeaconReceiverRemoved(address indexed beaconReceiver);

    modifier onlyVoting() {
        require(msg.sender == VOTING, "MSG_SENDER_MUST_BE_VOTING");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == ORACLE, "MSG_SENDER_MUST_BE_ORACLE");
        _;
    }
    constructor(address _voting, address _oracle) {
        require(_voting != address(0), "VOTING_ZERO_ADDRESS");
        require(_oracle != address(0), "ORACLE_ZERO_ADDRESS");

        VOTING = _voting;
        ORACLE = _oracle;
    }

    function addBeaconReceiver(address _receiver) external onlyVoting {
        beaconReceivers.push(_receiver);
    }

    function insertBeaconReceiver(address _receiver, uint _beforeGivenIndex) external onlyVoting {
        require(_beforeGivenIndex <= beaconReceivers.length, "INDEX_IS_OUT_OF_RANGE");

        emit BeaconReceiverAdded(_receiver);

        uint oldBRArrayLength = beaconReceivers.length;
        beaconReceivers.push();

        for (uint brIndex = _beforeGivenIndex; brIndex < oldBRArrayLength; brIndex++) {
            beaconReceivers[brIndex+1] = beaconReceivers[brIndex];
        }

        beaconReceivers[_beforeGivenIndex] = _receiver;
    }

    function removeBeaconReceiver(uint _index) external onlyVoting {
        require(_index < beaconReceivers.length, "INDEX_IS_OUT_OF_RANGE");

        emit BeaconReceiverRemoved(beaconReceivers[_index]);

        for (uint brIndex = _index; brIndex < beaconReceivers.length-1; brIndex++) {
            beaconReceivers[brIndex] = beaconReceivers[brIndex+1];
        }

        beaconReceivers.pop();
    }

    function processLidoOracleReport(uint256 _postTotalPooledEther,
                                     uint256 _preTotalPooledEther,
                                     uint256 _timeElapsed) external override onlyOracle {

        for (uint brIndex = 0; brIndex < beaconReceivers.length; brIndex++) {
            IBeaconReportReceiver(beaconReceivers[brIndex])
                .processLidoOracleReport(_postTotalPooledEther, _preTotalPooledEther, _timeElapsed);
        }
    }
}