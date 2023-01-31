// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "../LidoOracleNew.sol";


/**
  * @dev Only for testing purposes! LidoOracleNew version with some functions exposed.
  */
contract LidoOracleNewMock is LidoOracleNew {
    uint256 private time;
    using UnstructuredStorage for bytes32;

    function setTime(uint256 _time) public {
        time = _time;
    }

    function getTimeOriginal() external view returns (uint256) {
        return ReportEpochChecker._getTime();
    }

    function _getTime() internal override view returns (uint256) {
        return time;
    }

    function setVersion(uint256 _version) external {
        CONTRACT_VERSION_POSITION.setStorageUint256(_version);
    }

    function calcReportHash(Report calldata _report)
        external pure
        returns (bytes32 reportHash)
    {
        reportHash = keccak256(abi.encode(_report));
    }
}