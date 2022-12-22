// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.4.24;

interface IStakingModule {
    function getTotalKeys() external view returns (uint256);
    function getTotalUsedKeys() external view returns (uint256);
    function getTotalStoppedKeys() external view returns (uint256);

    function getType() external view returns (bytes32);
    function setType(bytes32 _type) external; // module team

    function trimUnusedKeys() external;
    function getKeysOpIndex() external view returns (uint256);

    function prepNextSigningKeys(uint256 maxDepositsCount, bytes depositCalldata)
        external
        returns (uint256 keysCount, bytes memory pubkeys, bytes memory signatures);
}
