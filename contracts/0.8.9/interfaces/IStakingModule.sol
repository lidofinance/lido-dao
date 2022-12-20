// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

interface IStakingModule {
    
    function getFee() external view returns (uint16);

    function getTotalKeys() external view returns (uint256);
    function getTotalUsedKeys() external view returns (uint256);
    function getTotalStoppedKeys() external view returns (uint256);

    function getType() external view returns(uint16);
    function setType(uint16 _type) external;

    function getStakingRouter() external view returns(address);
    function setStakingRouter(address addr) external;

    function trimUnusedKeys() external;
    function getKeysOpIndex() external view returns (uint256);

    function prepNextSigningKeys(uint256 maxDepositsCount, bytes calldata depositCalldata) external returns (bytes memory pubkeys, bytes memory signatures);
}