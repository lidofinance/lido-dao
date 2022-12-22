// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

interface IStakingModule {
    function getTotalKeys() external view returns (uint256);
    function getTotalUsedKeys() external view returns (uint256);
    function getTotalStoppedKeys() external view returns (uint256);

    function getType() external view returns (bytes32);

    function trimUnusedKeys() external;
    function getKeysOpIndex() external view returns (uint256);

    function prepNextSigningKeys(uint256 maxDepositsCount, bytes calldata depositCalldata)
        external
        returns (uint256 keysCount, bytes memory pubkeys, bytes memory signatures);
}
