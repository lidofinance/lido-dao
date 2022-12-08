// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

enum ModuleType {
    PRO,
    SOLO,
    DVT
}
interface IModule {
    
    event NodeOperatorAdded(uint256 id, string name, address rewardAddress, uint64 stakingLimit);
    event NodeOperatorActiveSet(uint256 indexed id, bool active);
    event NodeOperatorNameSet(uint256 indexed id, string name);
    event NodeOperatorRewardAddressSet(uint256 indexed id, address rewardAddress);
    event NodeOperatorStakingLimitSet(uint256 indexed id, uint64 stakingLimit);
    event NodeOperatorTotalStoppedValidatorsReported(uint256 indexed id, uint64 totalStopped);
    event NodeOperatorTotalKeysTrimmed(uint256 indexed id, uint64 totalKeysTrimmed);
    event SigningKeyAdded(uint256 indexed operatorId, bytes pubkey);
    event SigningKeyRemoved(uint256 indexed operatorId, bytes pubkey);
    event KeysOpIndexSet(uint256 keysOpIndex);

    function getFee() external view returns (uint16);

    function getTotalKeys() external view returns (uint256);
    function getTotalUsedKeys() external view returns (uint256);
    function getTotalStoppedKeys() external view returns (uint256);
    function getTotalExitedKeys() external view returns (uint256);

    function setStakingRouter(address addr) external;
    function trimUnusedKeys() external;

    // function addNodeOperator(string memory _name, address _rewardAddress) external returns (uint256 id);
    // function setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit) external;
    // function addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes memory _pubkeys, bytes memory _signatures) external;
    // function addSigningKeysOperatorBH(uint256 _operator_id, uint256 _quantity, bytes memory _pubkeys, bytes memory _signatures) external;
    // function assignNextSigningKeys(uint256 _numKeys) external returns (bytes memory pubkeys, bytes memory signatures);
    // function setNodeOperatorActive(uint256 _id, bool _active) external;
    
}