// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.4.24;

interface IStakingModule {
    function getTotalKeys() external view returns (uint256);
    function getTotalUsedKeys() external view returns (uint256);
    function getTotalStoppedKeys() external view returns (uint256);

    function getType() external view returns (uint16);
    function setType(uint16 _type) external; // module team

    function getStakingRouter() external view returns (address);
    function setStakingRouter(address addr) external; // lido team

    function trimUnusedKeys() external;
    function getKeysOpIndex() external view returns (uint256);

    function prepNextSigningKeys(uint256 maxDepositsCount, bytes depositCalldata)
        external
        returns (uint256 keysCount, bytes memory pubkeys, bytes memory signatures);
}
