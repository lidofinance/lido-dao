// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../Lido.sol";
import "./VaultMock.sol";

/**
 * @dev Only for testing purposes! Lido version with some functions exposed.
 */
contract LidoMock is Lido {
    bytes32 internal constant ALLOW_TOKEN_POSITION = keccak256("lido.Lido.allowToken");
    uint256 internal constant UNLIMITED_TOKEN_REBASE = uint256(-1);

    function initialize(
        address _oracle,
        address _treasury,
        address _stakingRouterAddress,
        address _dsmAddress,
        address _executionLayerRewardsVault,
        address _withdrawalQueue,
        address _eip712StETH
    )
        public
    {
        if (_treasury == address(0)) {
            _treasury = new VaultMock();
        }
        if (_executionLayerRewardsVault == address(0)) {
            _executionLayerRewardsVault = new VaultMock();
        }
        super.initialize(
            _oracle,
            _treasury,
            _stakingRouterAddress,
            _dsmAddress,
            _executionLayerRewardsVault,
            _withdrawalQueue,
            _eip712StETH
        );

        setAllowRecoverability(true);
    }

    /**
     * @dev For use in tests to make protocol operational after deployment
     */
    function resumeProtocolAndStaking() public {
        _resume();
        _resumeStaking();
        _setMaxPositiveTokenRebase(UNLIMITED_TOKEN_REBASE);
    }

    /**
     * @dev Gets unaccounted (excess) Ether on this contract balance
     */
    function getUnaccountedEther() public view returns (uint256) {
        return _getUnaccountedEther();
    }

    /**
     * @dev Only for testing recovery vault
     */
    function makeUnaccountedEther() public payable {}

    function setVersion(uint256 _version) external {
        CONTRACT_VERSION_POSITION.setStorageUint256(_version);
    }

    function allowRecoverability(address /*token*/) public view returns (bool) {
        return getAllowRecoverability();
    }

    function setAllowRecoverability(bool allow) public {
        ALLOW_TOKEN_POSITION.setStorageBool(allow);
    }

    function getAllowRecoverability() public view returns (bool) {
        return ALLOW_TOKEN_POSITION.getStorageBool();
    }

    function resetEip712StETH() external {
        EIP712_STETH_POSITION.setStorageAddress(0);
    }
}
