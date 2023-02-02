// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

import {ILidoLocator} from "./interfaces/ILidoLocator.sol";

/**
 * @title LidoLocator
 * @author mymphe
 * @notice The tourist brochure of the Lido protocol components
 */
contract LidoLocator is AccessControlEnumerable, ILidoLocator {
    /**
     * @notice DepositSecurityModule address set to a new value
     * @param depositSecurityModule new address of DepositSecurityModule
     * @param setBy address of the setter
     */
    event DepositSecurityModuleSet(address depositSecurityModule, address setBy);

    /**
     * @notice ELRewardsVault address set to a new value
     * @param elRewardsVault new address of ELRewardsVault
     * @param setBy address of the setter
     */
    event ELRewardsVaultSet(address elRewardsVault, address setBy);

    /**
     * @notice Oracle address set to a new value
     * @param oracle new address of Oracle
     * @param setBy address of the setter
     */
    event OracleSet(address oracle, address setBy);

    /**
     * @notice PostTokenRebaseReceiver address set to a new value
     * @param postTokenRebaseReceiver new address of PostTokenRebaseReceiver
     * @param setBy address of the setter
     */
    event PostTokenRebaseReceiverSet(address postTokenRebaseReceiver, address setBy);

    /**
     * @notice SafetyNetsRegistry address set to a new value
     * @param safetyNetsRegistry new address of SafetyNetsRegistry
     * @param setBy address of the setter
     */
    event SafetyNetsRegistrySet(address safetyNetsRegistry, address setBy);

    /**
     * @notice SelfOwnedStETHBurner address set to a new value
     * @param selfOwnedStETHBurner new address of SelfOwnedStETHBurner
     * @param setBy address of the setter
     */
    event SelfOwnedStETHBurnerSet(address selfOwnedStETHBurner, address setBy);

    /**
     * @notice StakingRouter address set to a new value
     * @param stakingRouter new address of StakingRouter
     * @param setBy address of the setter
     */
    event StakingRouterSet(address stakingRouter, address setBy);

    /**
     * @notice Treasury address set to a new value
     * @param treasury new address of Treasury
     * @param setBy address of the setter
     */
    event TreasurySet(address treasury, address setBy);

    /**
     * @notice WithdrawalQueue address set to a new value
     * @param withdrawalQueue new address of WithdrawalQueue
     * @param setBy address of the setter
     */
    event WithdrawalQueueSet(address withdrawalQueue, address setBy);

    /**
     * @notice WithdrawalVault address set to a new value
     * @param withdrawalVault new address of WithdrawalVault
     * @param setBy address of the setter
     */
    event WithdrawalVaultSet(address withdrawalVault, address setBy);

    error ErrorZeroAddress();
    error ErrorSameAddress();

    /**
     * @notice address of Lido
     */
    address internal immutable lido;

    /**
     * @notice address of the DepositSecurityModule contract
     */
    address internal depositSecurityModule;

    /**
     * @notice address of the ElRewardsVault contract
     */
    address internal elRewardsVault;

    /**
     * @notice address of the Oracle contract
     */
    address internal oracle;

    /**
     * @notice address of the PostTokenRebaseReceiver contract
     */
    address internal postTokenRebaseReceiver;

    /**
     * @notice address of the SafetyNetsRegistry contract
     */
    address internal safetyNetsRegistry;

    /**
     * @notice address of the SelfOwnedStETHBurner contract
     */
    address internal selfOwnedStETHBurner;

    /**
     * @notice address of the StakingRouter contract
     */
    address internal stakingRouter;

    /**
     * @notice address of the Treasury contract
     */
    address internal treasury;

    /**
     * @notice address of the WithdrawalQueue contract
     */
    address internal withdrawalQueue;

    /**
     * @notice address of the WithdrawalVault contract
     */
    address internal withdrawalVault;


    /**
     * @notice role identifier for setting DepositSecurityModule
     */
    bytes32 public constant SET_DEPOSIT_SECURITY_MODULE_ROLE = keccak256("SET_DEPOSIT_SECURITY_MODULE_ROLE");

    /**
     * @notice role identifier for setting ELRewardsVault
     */
    bytes32 public constant SET_EL_REWARDS_VAULT_ROLE = keccak256("SET_EL_REWARDS_VAULT_ROLE");

    /**
     * @notice role identifier for setting Oracle
     */
    bytes32 public constant SET_ORACLE_ROLE = keccak256("SET_ORACLE_ROLE");

    /**
     * @notice role identifier for setting PostTokenRebaseReceiver
     */
    bytes32 public constant SET_POST_TOKEN_REBASE_RECEIVER_ROLE = keccak256("SET_POST_TOKEN_REBASE_RECEIVER_ROLE");

    /**
     * @notice role identifier for setting SafetyNetsRegistry
     */
    bytes32 public constant SET_SAFETY_NETS_REGISTRY_ROLE = keccak256("SET_SAFETY_NETS_REGISTRY_ROLE");

    /**
     * @notice role identifier for setting SelfOwnedStETHBurner
     */
    bytes32 public constant SET_SELF_OWNED_STETH_BURNER_ROLE = keccak256("SET_SELF_OWNED_STETH_BURNER_ROLE");

    /**
     * @notice role identifier for setting StakingRouter
     */
    bytes32 public constant SET_STAKING_ROUTER_ROLE = keccak256("SET_STAKING_ROUTER_ROLE");

    /**
     * @notice role identifier for setting Treasury
     */
    bytes32 public constant SET_TREASURY_ROLE = keccak256("SET_TREASURY_ROLE");

    /**
     * @notice role identifier for setting WithdrawalQueue
     */
    bytes32 public constant SET_WITHDRAWAL_QUEUE_ROLE = keccak256("SET_WITHDRAWAL_QUEUE_ROLE");

    /**
     * @notice role identifier for setting WithdrawalVault
     */
    bytes32 public constant SET_WITHDRAWAL_VAULT = keccak256("SET_WITHDRAWAL_VAULT");

    /**
     * @notice disallow address(0)
     * @param _address target address
     */
    modifier onlyNonZeroAddress(address _address) {
        if (_address == address(0)) revert ErrorZeroAddress();
        _;
    }

    /**
     * @notice disallow setting to the same address
     * @param _newAddress new address
     * @param _currentAddress current address
     */
    modifier onlyNewAddress(address _newAddress, address _currentAddress) {
        if (_newAddress == _currentAddress) revert ErrorSameAddress();
        _;
    }

    /**
     * @notice set the roles manager and initialize necessary state variables
     * @dev accepts an array to avoid the "stack-too-deep" error
     * @param _addresses array of addresses
     * Order follows the logic: roles manager, Lido and the rest are in the alphabetical order:
     * [0] roles manager
     * [1] Lido
     * [2] DepositSecurityModule
     * [3] ELRewardsVault
     * [4] Oracle;
     * [5] PostTokenRebaseReceiver;
     * [6] SafetyNetsRegistry;
     * [7] SelfOwnedStETHBurner;
     * [8] StakingRouter;
     * [9] Treasury;
     * [10] WithdrawalQueue;
     * [11] WithdrawalVault;
     */
    constructor(address[] memory _addresses) {
        require(_addresses.length == 12, "INCORRECT_LENGTH");

        _setupRole(DEFAULT_ADMIN_ROLE, _addresses[0]);

        if (_addresses[1] == address(0)) revert ErrorZeroAddress();
        lido = _addresses[1];
        
        _setDepositSecurityModule(_addresses[2]);
        _setELRewardsVault(_addresses[3]);
        _setOracle(_addresses[4]);
        _setPostTokenRebaseReceiver(_addresses[5]);
        _setSafetyNetsRegistry(_addresses[6]);
        _setSelfOwnedStETHBurner(_addresses[7]);
        _setStakingRouter(_addresses[8]);
        _setTreasury(_addresses[9]);
        _setWithdrawalQueue(_addresses[10]);
        _setWithdrawalVault(_addresses[11]);
    }

    /**
     * @notice get the address of the Lido contract
     * @return address of the Lido contract
     */
    function getLido() external view returns (address) {
        return lido;
    }

    /**
     * @notice get the address of the DepositSecurityModule contract
     * @return address of the DepositSecurityModule contract
     */
    function getDepositSecurityModule() external view returns (address) {
        return depositSecurityModule;
    }

    /**
     * @notice get the address of the ELRewardsVault contract
     * @return address of the ELRewardsVault contract
     */
    function getELRewardsVault() external view returns (address) {
        return elRewardsVault;
    }

    /**
     * @notice get the address of the Oracle contract
     * @return address of the Oracle contract
     */
    function getOracle() external view returns (address) {
        return oracle;
    }

    /**
     * @notice get the address of the PostTokenRebaseReceiver contract
     * @return address of the PostTokenRebaseReceiver contract
     */
    function getPostTokenRebaseReceiver() external view returns (address) {
        return postTokenRebaseReceiver;
    }

    /**
     * @notice get the address of the SafetyNetsRegistry contract
     * @return address of the SafetyNetsRegistry contract
     */
    function getSafetyNetsRegistry() external view returns (address) {
        return safetyNetsRegistry;
    }

    /**
     * @notice get the address of the SelfOwnedStETHBurner contract
     * @return address of the SelfOwnedStETHBurner contract
     */
    function getSelfOwnedStETHBurner() external view returns (address) {
        return selfOwnedStETHBurner;
    }

    /**
     * @notice get the address of the StakingRouter contract
     * @return address of the StakingRouter contract
     */
    function getStakingRouter() external view returns (address) {
        return stakingRouter;
    }

    /**
     * @notice get the address of the Treasury contract
     * @return address of the Treasury contract
     */
    function getTreasury() external view returns (address) {
        return treasury;
    }

    /**
     * @notice get the address of the tWithdrawalQueue contract
     * @return address of the WithdrawalQueue contract
     */
    function getWithdrawalQueue() external view returns (address) {
        return withdrawalQueue;
    }

    /**
     * @notice get the address of the WithdrawalVault contract
     * @return address of the WithdrawalVault contract
     */
    function getWithdrawalVault() external view returns (address) {
        return withdrawalVault;
    }

    /**
     * @notice set DepositSecurityModule to a new address
     * @param _address new address of DepositSecurityModule
     */
    function setDepositSecurityModule(address _address)
        external
        onlyRole(SET_DEPOSIT_SECURITY_MODULE_ROLE)
    {
        _setDepositSecurityModule(_address);
    }

    /**
     * @notice set ELRewardsVault to a new address
     * @param _address new address of ELRewardsVault
     */
    function setELRewardsVault(address _address)
        external
        onlyRole(SET_EL_REWARDS_VAULT_ROLE)
    {
        _setELRewardsVault(_address);
    }

    /**
     * @notice set Oracle to a new address
     * @param _address new address of Oracle
     */
    function setOracle(address _address)
        external
        onlyRole(SET_ORACLE_ROLE)
    {
        _setOracle(_address);
    }

    /**
     * @notice set PostTokenRebaseReceiver to a new address
     * @param _address new address of PostTokenRebaseReceiver
     */
    function setPostTokenRebaseReceiver(address _address)
        external
        onlyRole(SET_POST_TOKEN_REBASE_RECEIVER_ROLE)
    {
        _setPostTokenRebaseReceiver(_address);
    }

    /**
     * @notice set SafetyNetsRegistry to a new address
     * @param _address new address of SafetyNetsRegistry
     */
    function setSafetyNetsRegistry(address _address)
        external
        onlyRole(SET_SAFETY_NETS_REGISTRY_ROLE)
    {
        _setSafetyNetsRegistry(_address);
    }

    /**
     * @notice set SelfOwnedStETHBurner to a new address
     * @param _address new address of SelfOwnedStETHBurner
     */
    function setSelfOwnedStETHBurner(address _address)
        external
        onlyRole(SET_SELF_OWNED_STETH_BURNER_ROLE)
    {
        _setSelfOwnedStETHBurner(_address);
    }

    /**
     * @notice set StakingRouter to a new address
     * @param _address new address of StakingRouter
     */
    function setStakingRouter(address _address)
        external
        onlyRole(SET_STAKING_ROUTER_ROLE)
    {
        _setStakingRouter(_address);
    }

    /**
     * @notice set Treasury to a new address
     * @param _address new address of Treasury
     */
    function setTreasury(address _address)
        external
        onlyRole(SET_TREASURY_ROLE)
    {
        _setTreasury(_address);
    }

    /**
     * @notice set WithdrawalQueue to a new address
     * @param _address new address of WithdrawalQueue
     */
    function setWithdrawalQueue(address _address)
        external
        onlyRole(SET_WITHDRAWAL_QUEUE_ROLE)
    {
        _setWithdrawalQueue(_address);
    }

    /**
     * @notice set WithdrawalVault to a new address
     * @param _address new address of WithdrawalVault
     */
    function setWithdrawalVault(address _address)
        external
        onlyRole(SET_WITHDRAWAL_VAULT)
    {
        _setWithdrawalVault(_address);
    }

    function _setDepositSecurityModule(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, depositSecurityModule)
    {
        depositSecurityModule = _address;

        emit DepositSecurityModuleSet(_address, msg.sender);
    }

    function _setELRewardsVault(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, elRewardsVault)
    {
        elRewardsVault = _address;

        emit ELRewardsVaultSet(_address, msg.sender);
    }

    function _setOracle(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, oracle)
    {
        oracle = _address;

        emit OracleSet(_address, msg.sender);
    }

    function _setPostTokenRebaseReceiver(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, postTokenRebaseReceiver)
    {
        postTokenRebaseReceiver = _address;

        emit PostTokenRebaseReceiverSet(_address, msg.sender);
    }

    function _setSafetyNetsRegistry(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, safetyNetsRegistry)
    {
        safetyNetsRegistry = _address;

        emit SafetyNetsRegistrySet(_address, msg.sender);
    }

    function _setSelfOwnedStETHBurner(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, selfOwnedStETHBurner)
    {
        selfOwnedStETHBurner = _address;

        emit SelfOwnedStETHBurnerSet(_address, msg.sender);
    }

    function _setStakingRouter(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, stakingRouter)
    {
        stakingRouter = _address;

        emit StakingRouterSet(_address, msg.sender);
    }

    function _setTreasury(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, treasury)
    {
        treasury = _address;

        emit TreasurySet(_address, msg.sender);
    }

    function _setWithdrawalQueue(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, withdrawalQueue)
    {
        withdrawalQueue = _address;

        emit WithdrawalQueueSet(_address, msg.sender);
    }

    function _setWithdrawalVault(address _address)
        internal
        onlyNonZeroAddress(_address)
        onlyNewAddress(_address, withdrawalVault)
    {
        withdrawalVault = _address;

        emit WithdrawalVaultSet(_address, msg.sender);
    }
}
