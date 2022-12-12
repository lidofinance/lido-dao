// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.4.24;
interface IStakingModule {
    
    function getFee() external view returns (uint16);

    function getTotalKeys() external view returns (uint256);
    function getTotalUsedKeys() external view returns (uint256);
    function getTotalStoppedKeys() external view returns (uint256);
    function getTotalExitedKeys() external view returns (uint256);

    function getType() external returns(uint16);
    function setType(uint16 _type) external;

    function getStakingRouter() external returns(address);
    function setStakingRouter(address addr) external;

    function trimUnusedKeys() external;
}