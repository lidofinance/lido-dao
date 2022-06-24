// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import "./OrderedCallbacksArray.sol";
import "./interfaces/IBeaconReportReceiver.sol";

/**
  * @title Contract defining an composite post-rebase beacon receiver for the Lido oracle
  *
  * Contract adds permission modifiers.
  * Only the `ORACLE` address can invoke `processLidoOracleReport` function.
  */
contract CompositePostRebaseBeaconReceiver is OrderedCallbacksArray, IBeaconReportReceiver, ERC165 {
    address public immutable ORACLE;

    modifier onlyOracle() {
        require(msg.sender == ORACLE, "MSG_SENDER_MUST_BE_ORACLE");
        _;
    }

    constructor(
        address _voting,
        address _oracle
    ) OrderedCallbacksArray(_voting, type(IBeaconReportReceiver).interfaceId) {
        require(_oracle != address(0), "ORACLE_ZERO_ADDRESS");

        ORACLE = _oracle;
    }

    function processLidoOracleReport(
        uint256 _postTotalPooledEther,
        uint256 _preTotalPooledEther,
        uint256 _timeElapsed
    ) external virtual override onlyOracle {
        uint256 callbacksLen = callbacksLength();

        for (uint256 brIndex = 0; brIndex < callbacksLen; brIndex++) {
            IBeaconReportReceiver(callbacks[brIndex])
                .processLidoOracleReport(
                    _postTotalPooledEther,
                    _preTotalPooledEther,
                    _timeElapsed
                );
        }
    }

    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return (
            _interfaceId == type(IBeaconReportReceiver).interfaceId
            || super.supportsInterface(_interfaceId)
        );
    }
}
