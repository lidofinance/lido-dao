// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "./OrderedBeaconReportReceivers.sol";
import "./interfaces/IBeaconReportReceiver.sol";

contract CompositePostRebaseBeaconReceiver is OrderedBeaconReportReceivers, IBeaconReportReceiver {

    constructor(address _voting, address _oracle) OrderedBeaconReportReceivers(_voting, _oracle) {
        // nothing to do yet
    }

    function processLidoOracleReport(uint256 _postTotalPooledEther,
                                     uint256 _preTotalPooledEther,
                                     uint256 _timeElapsed) external override onlyOracle {

        uint256 callbacksLength = callbacks.length;

        for (uint256 brIndex = 0; brIndex < callbacksLength; brIndex++) {
            IBeaconReportReceiver(callbacks[brIndex])
                .processLidoOracleReport(_postTotalPooledEther, _preTotalPooledEther, _timeElapsed);
        }
    }
}