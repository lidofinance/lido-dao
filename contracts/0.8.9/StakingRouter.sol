// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

import {IStakingModule, ValidatorsReport} from "./interfaces/IStakingModule.sol";

import {Math256} from "../common/lib/Math256.sol";
import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";
import {MinFirstAllocationStrategy} from "../common/lib/MinFirstAllocationStrategy.sol";

import {BeaconChainDepositor} from "./BeaconChainDepositor.sol";
import {Versioned} from "./utils/Versioned.sol";

interface ILido {
    function getBufferedEther() external view returns (uint256);
    function receiveStakingRouterDepositRemainder() external payable;
}

contract StakingRouter is AccessControlEnumerable, BeaconChainDepositor, Versioned {
    using UnstructuredStorage for bytes32;

    /// @dev events
    event StakingModuleAdded(uint24 indexed stakingModuleId, address stakingModule, string name, address createdBy);
    event StakingModuleTargetShareSet(uint24 indexed stakingModuleId, uint16 targetShare, address setBy);
    event StakingModuleFeesSet(uint24 indexed stakingModuleId, uint16 stakingModuleFee, uint16 treasuryFee, address setBy);
    event StakingModuleStatusSet(uint24 indexed stakingModuleId, StakingModuleStatus status, address setBy);
    event StakingModuleExitedValidatorsIncompleteReporting(uint24 indexed stakingModuleId, uint256 unreportedExitedValidatorsCount);
    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials, address setBy);
    /**
     * Emitted when the StakingRouter received ETH
     */
    event StakingRouterETHDeposited(uint24 indexed stakingModuleId, uint256 amount);

    /// @dev errors
    error ErrorZeroAddress(string field);
    error ErrorValueOver100Percent(string field);
    error ErrorStakingModuleNotActive();
    error ErrorStakingModuleNotPaused();
    error ErrorEmptyWithdrawalsCredentials();
    error ErrorDirectETHTransfer();
    error ErrorExitedValidatorsCountCannotDecrease();
    error ErrorStakingModulesLimitExceeded();
    error ErrorStakingModuleIdTooLarge();
    error ErrorStakingModuleUnregistered();
    error ErrorAppAuthLidoFailed();
    error ErrorStakingModuleStatusTheSame();
    error ErrorStakingModuleWrongName();
    error UnexpectedCurrentValidatorsCount(
        uint256 currentModuleExitedValidatorsCount,
        uint256 currentNodeOpExitedValidatorsCount,
        uint256 currentNodeOpStuckValidatorsCount
    );

    enum StakingModuleStatus {
        Active, // deposits and rewards allowed
        DepositsPaused, // deposits NOT allowed, rewards allowed
        Stopped // deposits and rewards NOT allowed
    }

    struct StakingModule {
        /// @notice unique id of the staking module
        uint24 id;
        /// @notice address of staking module
        address stakingModuleAddress;
        /// @notice part of the fee taken from staking rewards that goes to the staking module
        uint16 stakingModuleFee;
        /// @notice part of the fee taken from staking rewards that goes to the treasury
        uint16 treasuryFee;
        /// @notice target percent of total validators in protocol, in BP
        uint16 targetShare;
        /// @notice staking module status if staking module can not accept the deposits or can participate in further reward distribution
        uint8 status;
        /// @notice name of staking module
        string name;
        /// @notice block.timestamp of the last deposit of the staking module
        uint64 lastDepositAt;
        /// @notice block.number of the last deposit of the staking module
        uint256 lastDepositBlock;
        /// @notice number of exited validators
        uint256 exitedValidatorsCount;
    }

    struct StakingModuleCache {
        address stakingModuleAddress;
        uint24 stakingModuleId;
        uint16 stakingModuleFee;
        uint16 treasuryFee;
        uint16 targetShare;
        StakingModuleStatus status;
        uint256 activeValidatorsCount;
        uint256 availableValidatorsCount;
    }

    bytes32 public constant MANAGE_WITHDRAWAL_CREDENTIALS_ROLE = keccak256("MANAGE_WITHDRAWAL_CREDENTIALS_ROLE");
    bytes32 public constant STAKING_MODULE_PAUSE_ROLE = keccak256("STAKING_MODULE_PAUSE_ROLE");
    bytes32 public constant STAKING_MODULE_RESUME_ROLE = keccak256("STAKING_MODULE_RESUME_ROLE");
    bytes32 public constant STAKING_MODULE_MANAGE_ROLE = keccak256("STAKING_MODULE_MANAGE_ROLE");
    bytes32 public constant REPORT_EXITED_VALIDATORS_ROLE = keccak256("REPORT_EXITED_VALIDATORS_ROLE");
    bytes32 public constant UNSAFE_SET_EXITED_VALIDATORS_ROLE = keccak256("UNSAFE_SET_EXITED_VALIDATORS_ROLE");
    bytes32 public constant REPORT_REWARDS_MINTED_ROLE = keccak256("REPORT_REWARDS_MINTED_ROLE");

    bytes32 internal constant LIDO_POSITION = keccak256("lido.StakingRouter.lido");

    /// @dev Credentials which allows the DAO to withdraw Ether on the 2.0 side
    bytes32 internal constant WITHDRAWAL_CREDENTIALS_POSITION = keccak256("lido.StakingRouter.withdrawalCredentials");

    /// @dev total count of staking modules
    bytes32 internal constant STAKING_MODULES_COUNT_POSITION = keccak256("lido.StakingRouter.stakingModulesCount");
    /// @dev id of the last added staking module. This counter grow on staking modules adding
    bytes32 internal constant LAST_STAKING_MODULE_ID_POSITION = keccak256("lido.StakingRouter.lastStakingModuleId");
    /// @dev mapping is used instead of array to allow to extend the StakingModule
    bytes32 internal constant STAKING_MODULES_MAPPING_POSITION = keccak256("lido.StakingRouter.stakingModules");
    /// @dev Position of the staking modules in the `_stakingModules` map, plus 1 because
    ///      index 0 means a value is not in the set.
    bytes32 internal constant STAKING_MODULE_INDICES_MAPPING_POSITION = keccak256("lido.StakingRouter.stakingModuleIndicesOneBased");

    uint256 public constant FEE_PRECISION_POINTS = 10 ** 20; // 100 * 10 ** 18
    uint256 public constant TOTAL_BASIS_POINTS = 10000;

    uint256 internal constant UINT24_MAX = type(uint24).max;

    modifier validStakingModuleId(uint256 _stakingModuleId) {
        if (_stakingModuleId > UINT24_MAX) revert ErrorStakingModuleIdTooLarge();
        _;
    }

    constructor(address _depositContract) BeaconChainDepositor(_depositContract) {}

    /**
     * @dev proxy initialization
     * @param _admin Lido DAO Aragon agent contract address
     * @param _lido Lido address
     * @param _withdrawalCredentials Lido withdrawal vault contract address
     */
    function initialize(address _admin, address _lido, bytes32 _withdrawalCredentials) external {
        if (_admin == address(0)) revert ErrorZeroAddress("_admin");
        if (_lido == address(0)) revert ErrorZeroAddress("_lido");

        _initializeContractVersionTo(1);

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        LIDO_POSITION.setStorageAddress(_lido);
        WITHDRAWAL_CREDENTIALS_POSITION.setStorageBytes32(_withdrawalCredentials);
        emit WithdrawalCredentialsSet(_withdrawalCredentials, msg.sender);
    }

    /// @dev prohibit direct transfer to contract
    receive() external payable {
        revert ErrorDirectETHTransfer();
    }

    /**
     * @notice Return the Lido contract address
     */
    function getLido() public view returns (ILido) {
        return ILido(LIDO_POSITION.getStorageAddress());
    }

    /**
     * @notice register a new staking module
     * @param _name name of staking module
     * @param _stakingModuleAddress address of staking module
     * @param _targetShare target total stake share
     * @param _stakingModuleFee fee of the staking module taken from the consensus layer rewards
     * @param _treasuryFee treasury fee
     */
    function addStakingModule(
        string calldata _name,
        address _stakingModuleAddress,
        uint16 _targetShare,
        uint16 _stakingModuleFee,
        uint16 _treasuryFee
    ) external onlyRole(STAKING_MODULE_MANAGE_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_stakingModuleFee + _treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_stakingModuleFee + _treasuryFee");
        if (_stakingModuleAddress == address(0)) revert ErrorZeroAddress("_stakingModuleAddress");
        if (bytes(_name).length == 0 || bytes(_name).length > 32) revert ErrorStakingModuleWrongName();

        uint256 newStakingModuleIndex = getStakingModulesCount();

        if (newStakingModuleIndex >= 32) revert ErrorStakingModulesLimitExceeded();
        StakingModule storage newStakingModule = _getStakingModuleByIndex(newStakingModuleIndex);
        uint24 newStakingModuleId = uint24(LAST_STAKING_MODULE_ID_POSITION.getStorageUint256()) + 1;

        newStakingModule.id = newStakingModuleId;
        newStakingModule.name = _name;
        newStakingModule.stakingModuleAddress = _stakingModuleAddress;
        newStakingModule.targetShare = _targetShare;
        newStakingModule.stakingModuleFee = _stakingModuleFee;
        newStakingModule.treasuryFee = _treasuryFee;
        /// @dev since `enum` is `uint8` by nature, so the `status` is stored as `uint8` to avoid possible problems when upgrading.
        ///      But for human readability, we use `enum` as function parameter type.
        ///      More about conversion in the docs https://docs.soliditylang.org/en/v0.8.17/types.html#enums
        newStakingModule.status = uint8(StakingModuleStatus.Active);

        _setStakingModuleIndexById(newStakingModuleId, newStakingModuleIndex);
        LAST_STAKING_MODULE_ID_POSITION.setStorageUint256(newStakingModuleId);
        STAKING_MODULES_COUNT_POSITION.setStorageUint256(newStakingModuleIndex + 1);

        emit StakingModuleAdded(newStakingModuleId, _stakingModuleAddress, _name, msg.sender);
        emit StakingModuleTargetShareSet(newStakingModuleId, _targetShare, msg.sender);
        emit StakingModuleFeesSet(newStakingModuleId, _stakingModuleFee, _treasuryFee, msg.sender);
    }

    /**
     * @notice Update staking module params
     * @param _stakingModuleId staking module id
     * @param _targetShare target total stake share
     * @param _stakingModuleFee fee of the staking module taken from the consensus layer rewards
     * @param _treasuryFee treasury fee
     */
    function updateStakingModule(
        uint256 _stakingModuleId,
        uint16 _targetShare,
        uint16 _stakingModuleFee,
        uint16 _treasuryFee
    ) external
      validStakingModuleId(_stakingModuleId)
      onlyRole(STAKING_MODULE_MANAGE_ROLE)
    {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_stakingModuleFee + _treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_stakingModuleFee + _treasuryFee");

        uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        StakingModule storage stakingModule = _getStakingModuleByIndex(stakingModuleIndex);

        stakingModule.targetShare = _targetShare;
        stakingModule.treasuryFee = _treasuryFee;
        stakingModule.stakingModuleFee = _stakingModuleFee;

        emit StakingModuleTargetShareSet(uint24(_stakingModuleId), _targetShare, msg.sender);
        emit StakingModuleFeesSet(uint24(_stakingModuleId), _stakingModuleFee, _treasuryFee, msg.sender);
    }

    function reportRewardsMinted(uint256[] calldata _stakingModuleIds, uint256[] calldata _totalShares)
        external
        onlyRole(REPORT_REWARDS_MINTED_ROLE)
    {
        for (uint256 i = 0; i < _stakingModuleIds.length; ) {
            address moduleAddr = _getStakingModuleById(_stakingModuleIds[i]).stakingModuleAddress;
            IStakingModule(moduleAddr).handleRewardsMinted(_totalShares[i]);
            unchecked { ++i; }
        }
    }

    function updateExitedValidatorsCountByStakingModule(
        uint256[] calldata _stakingModuleIds,
        uint256[] calldata _exitedValidatorsCounts
    )
        external
        onlyRole(REPORT_EXITED_VALIDATORS_ROLE)
    {
        for (uint256 i = 0; i < _stakingModuleIds.length; ) {
            StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleIds[i]);
            uint256 prevReportedExitedValidatorsCount = stakingModule.exitedValidatorsCount;
            if (_exitedValidatorsCounts[i] < prevReportedExitedValidatorsCount) {
                revert ErrorExitedValidatorsCountCannotDecrease();
            }

            ValidatorsReport memory allValidatorsReport = 
                IStakingModule(stakingModule.stakingModuleAddress).getValidatorsReport();

            if (allValidatorsReport.totalExited < prevReportedExitedValidatorsCount) {
                // not all of the exited validators were async reported to the module
                emit StakingModuleExitedValidatorsIncompleteReporting(
                    stakingModule.id,
                    prevReportedExitedValidatorsCount - allValidatorsReport.totalExited
                );
            }
            stakingModule.exitedValidatorsCount = _exitedValidatorsCounts[i];
            unchecked { ++i; }
        }
    }

    function reportStakingModuleExitedValidatorsCountByNodeOperator(
        uint256 _stakingModuleId,
        uint256[] calldata _nodeOperatorIds,
        uint256[] calldata _exitedValidatorsCounts
    )
        external
        onlyRole(REPORT_EXITED_VALIDATORS_ROLE)
    {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        address moduleAddr = stakingModule.stakingModuleAddress;
        ValidatorsReport memory allValidatorsReport = 
                IStakingModule(stakingModule.stakingModuleAddress).getValidatorsReport();

        uint256 newExitedValidatorsCount;
        for (uint256 i = 0; i < _nodeOperatorIds.length; ) {
            newExitedValidatorsCount = IStakingModule(moduleAddr)
                .updateExitedValidatorsCount(_nodeOperatorIds[i], _exitedValidatorsCounts[i]);
            unchecked { ++i; }
        }
        uint256 prevReportedExitedValidatorsCount = stakingModule.exitedValidatorsCount;
        if (allValidatorsReport.totalExited < prevReportedExitedValidatorsCount &&
            newExitedValidatorsCount >= prevReportedExitedValidatorsCount
        ) {
            // oracle finished updating exited validators for all node ops
            IStakingModule(moduleAddr).finishUpdatingExitedValidatorsCount();
        }
    }

    struct ValidatorsCountCorrection {
        uint256 currentModuleExitedValidatorsCount;
        uint256 currentNodeOperatorExitedValidatorsCount;
        uint256 currentNodeOperatorStuckValidatorsCount;
        uint256 newModuleExitedValidatorsCount;
        uint256 newNodeOperatorExitedValidatorsCount;
        uint256 newNodeOperatorStuckValidatorsCount;
    }

    /**
     * @notice Sets exited validators count for the given module and given node operator in that module
     * without performing critical safety checks, e.g. that exited validators count cannot decrease.
     *
     * Should only be used by the DAO in extreme cases and with sufficient precautions to correct
     * invalid data reported by the oracle committee due to a bug in the oracle daemon.
     *
     * @param _stakingModuleId ID of the staking module.
     *
     * @param _nodeOperatorId ID of the node operator.
     *
     * @param _triggerUpdateFinish Whether to call `finishUpdatingExitedValidatorsCount` on
     *        the module after applying the corrections.
     *
     * @param _correction.currentModuleExitedValidatorsCount The expected current number of exited
     *       validators of the module that is being corrected.
     *
     * @param _correction.currentNodeOperatorExitedValidatorsCount The expected current number of exited
     *        validators of the node operator that is being corrected.
     *
     * @param _correction.currentNodeOperatorStuckValidatorsCount The expected current number of stuck
     *        validators of the node operator that is being corrected.
     *
     * @param _correction.newModuleExitedValidatorsCount The corrected number of exited validators of the module.
     *
     * @param _correction.newNodeOperatorExitedValidatorsCount The corrected number of exited validators of the
     *        node operator.
     *
     * @param _correction.newNodeOperatorStuckValidatorsCount The corrected number of stuck validators of the
     *        node operator.
     *
     * Reverts if the current numbers of exited and stuck validators of the module and node operator don't
     * match the supplied expected current values.
     */
    function unsafeSetExitedValidatorsCount(
        uint256 _stakingModuleId,
        uint256 _nodeOperatorId,
        bool _triggerUpdateFinish,
        ValidatorsCountCorrection memory _correction
    )
        external
        onlyRole(UNSAFE_SET_EXITED_VALIDATORS_ROLE)
    {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        address moduleAddr = stakingModule.stakingModuleAddress;

        ValidatorsReport memory operatorValidatorsReport = 
            IStakingModule(stakingModule.stakingModuleAddress).getValidatorsReport(_nodeOperatorId);

        // FIXME: get current value from the staking module
        uint256 nodeOpStuckValidatorsCount;

        if (_correction.currentModuleExitedValidatorsCount != stakingModule.exitedValidatorsCount ||
            _correction.currentNodeOperatorExitedValidatorsCount != operatorValidatorsReport.totalExited ||
            _correction.currentNodeOperatorStuckValidatorsCount != nodeOpStuckValidatorsCount
        ) {
            revert UnexpectedCurrentValidatorsCount(
                stakingModule.exitedValidatorsCount,
                operatorValidatorsReport.totalExited,
                nodeOpStuckValidatorsCount
            );
        }

        stakingModule.exitedValidatorsCount = _correction.newModuleExitedValidatorsCount;

        IStakingModule(moduleAddr).unsafeUpdateValidatorsCount(
            _nodeOperatorId,
            _correction.newNodeOperatorExitedValidatorsCount,
            _correction.newNodeOperatorStuckValidatorsCount
        );

        if (_triggerUpdateFinish) {
            IStakingModule(moduleAddr).finishUpdatingExitedValidatorsCount();
        }
    }

    function reportStakingModuleStuckValidatorsCountByNodeOperator(
        uint256 _stakingModuleId,
        uint256[] calldata _nodeOperatorIds,
        uint256[] calldata _stuckValidatorsCounts
    )
        external
        onlyRole(REPORT_EXITED_VALIDATORS_ROLE)
    {
        address moduleAddr = _getStakingModuleById(_stakingModuleId).stakingModuleAddress;
        for (uint256 i = 0; i < _nodeOperatorIds.length; ) {
            IStakingModule(moduleAddr).updateStuckValidatorsCount(
                _nodeOperatorIds[i],
                _stuckValidatorsCounts[i]
            );
            unchecked { ++i; }
        }
    }

    function getExitedValidatorsCountAcrossAllModules() external view returns (uint256) {
        uint256 stakingModulesCount = getStakingModulesCount();
        uint256 exitedValidatorsCount = 0;
        for (uint256 i; i < stakingModulesCount; ) {
            exitedValidatorsCount += _getStakingModuleByIndex(i).exitedValidatorsCount;
            unchecked { ++i; }
        }
        return exitedValidatorsCount;
    }

    /**
     * @notice Returns all registered staking modules
     */
    function getStakingModules() external view returns (StakingModule[] memory res) {
        uint256 stakingModulesCount = getStakingModulesCount();
        res = new StakingModule[](stakingModulesCount);
        for (uint256 i; i < stakingModulesCount; ) {
            res[i] = _getStakingModuleByIndex(i);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Returns the ids of all registered staking modules
     */
    function getStakingModuleIds() external view returns (uint24[] memory stakingModuleIds) {
        uint256 stakingModulesCount = getStakingModulesCount();
        stakingModuleIds = new uint24[](stakingModulesCount);
        for (uint256 i; i < stakingModulesCount; ) {
            stakingModuleIds[i] = _getStakingModuleByIndex(i).id;
            unchecked {
                ++i;
            }
        }
    }

    /**
     *  @dev Returns staking module by id
     */
    function getStakingModule(uint256 _stakingModuleId)
        external
        view
        validStakingModuleId(_stakingModuleId)
        returns (StakingModule memory)
    {
        return _getStakingModuleById(_stakingModuleId);
    }

    /**
     * @dev Returns total number of staking modules
     */
    function getStakingModulesCount() public view returns (uint256) {
        return STAKING_MODULES_COUNT_POSITION.getStorageUint256();
    }

    /**
     * @dev Returns status of staking module
     */
    function getStakingModuleStatus(uint256 _stakingModuleId) public view
        validStakingModuleId(_stakingModuleId)
        returns (StakingModuleStatus)
    {
        return StakingModuleStatus(_getStakingModuleById(_stakingModuleId).status);
    }

    /**
     * @notice set the staking module status flag for participation in further deposits and/or reward distribution
     */
    function setStakingModuleStatus(uint256 _stakingModuleId, StakingModuleStatus _status) external
        validStakingModuleId(_stakingModuleId)
        onlyRole(STAKING_MODULE_MANAGE_ROLE)
    {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        StakingModuleStatus _prevStatus = StakingModuleStatus(stakingModule.status);
        if (_prevStatus == _status) revert ErrorStakingModuleStatusTheSame();
        stakingModule.status = uint8(_status);
        emit StakingModuleStatusSet(uint24(_stakingModuleId), _status, msg.sender);
    }

    /**
     * @notice pause deposits for staking module
     * @param _stakingModuleId id of the staking module to be paused
     */
    function pauseStakingModule(uint256 _stakingModuleId) external
        validStakingModuleId(_stakingModuleId)
        onlyRole(STAKING_MODULE_PAUSE_ROLE)
    {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        StakingModuleStatus _prevStatus = StakingModuleStatus(stakingModule.status);
        if (_prevStatus != StakingModuleStatus.Active) revert ErrorStakingModuleNotActive();
        stakingModule.status = uint8(StakingModuleStatus.DepositsPaused);
        emit StakingModuleStatusSet(uint24(_stakingModuleId), StakingModuleStatus.DepositsPaused, msg.sender);
    }

    /**
     * @notice resume deposits for staking module
     * @param _stakingModuleId id of the staking module to be unpaused
     */
    function resumeStakingModule(uint256 _stakingModuleId) external
        validStakingModuleId(_stakingModuleId)
        onlyRole(STAKING_MODULE_RESUME_ROLE)
    {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        StakingModuleStatus _prevStatus = StakingModuleStatus(stakingModule.status);
        if (_prevStatus != StakingModuleStatus.DepositsPaused) revert ErrorStakingModuleNotPaused();
        stakingModule.status = uint8(StakingModuleStatus.Active);
        emit StakingModuleStatusSet(uint24(_stakingModuleId), StakingModuleStatus.Active, msg.sender);
    }

    function getStakingModuleIsStopped(uint256 _stakingModuleId) external view
        validStakingModuleId(_stakingModuleId)
        returns (bool)
    {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.Stopped;
    }

    function getStakingModuleIsDepositsPaused(uint256 _stakingModuleId) external view
        validStakingModuleId(_stakingModuleId)
        returns (bool)
    {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.DepositsPaused;
    }

    function getStakingModuleIsActive(uint256 _stakingModuleId) external view
        validStakingModuleId(_stakingModuleId)
        returns (bool)
    {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.Active;
    }

    function getStakingModuleDepositsDataNonce(uint256 _stakingModuleId) external view
        validStakingModuleId(_stakingModuleId)
        returns (uint256)
    {
        return IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getDepositsDataNonce();
    }

    function getStakingModuleLastDepositBlock(uint256 _stakingModuleId) external view
        validStakingModuleId(_stakingModuleId)
        returns (uint256)
    {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        return stakingModule.lastDepositBlock;
    }

    function getStakingModuleActiveValidatorsCount(uint256 _stakingModuleId) external view
        validStakingModuleId(_stakingModuleId)
        returns (uint256 activeValidatorsCount)
    {
        ValidatorsReport memory allValidatorsReport = 
            IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getValidatorsReport();

        activeValidatorsCount = allValidatorsReport.totalDeposited - allValidatorsReport.totalExited;
    }

    /**
     * @dev calculate max count of deposits which staking module can provide data for based on the
     *      current Staking Router balance and buffered Ether amount
     *
     * @param _stakingModuleId id of the staking module to be deposited
     * @return max number of deposits might be done using given staking module
     */
    function getStakingModuleMaxDepositsCount(uint256 _stakingModuleId) public view
        validStakingModuleId(_stakingModuleId)
        returns (uint256)
    {
        uint256 stakingModuleIndex = _getStakingModuleIndexById(uint24(_stakingModuleId));
        uint256 depositsToAllocate = getLido().getBufferedEther() / DEPOSIT_SIZE;
        (, uint256[] memory newDepositsAllocation, StakingModuleCache[] memory stakingModulesCache)
            = _getDepositsAllocation(depositsToAllocate);
        return newDepositsAllocation[stakingModuleIndex] - stakingModulesCache[stakingModuleIndex].activeValidatorsCount;
    }

    /**
     * @notice Returns the aggregate fee distribution proportion
     * @return modulesFee modules aggregate fee in base precision
     * @return treasuryFee treasury fee in base precision
     * @return basePrecision base precision: a value corresponding to the full fee
     */
    function getStakingFeeAggregateDistribution() public view returns (
        uint96 modulesFee,
        uint96 treasuryFee,
        uint256 basePrecision
    ) {
        uint96[] memory moduleFees;
        uint96 totalFee;
        (, , moduleFees, totalFee, basePrecision) = getStakingRewardsDistribution();
        for (uint256 i; i < moduleFees.length; ++i) {
            modulesFee += moduleFees[i];
        }
        treasuryFee = totalFee - modulesFee;
    }

    /**
     * @notice Return shares table
     *
     * @return recipients rewards recipient addresses corresponding to each module
     * @return stakingModuleIds module IDs
     * @return stakingModuleFees fee of each recipient
     * @return totalFee total fee to mint for each staking module and treasury
     * @return precisionPoints base precision number, which constitutes 100% fee
     */
    function getStakingRewardsDistribution()
        public
        view
        returns (
            address[] memory recipients,
            uint256[] memory stakingModuleIds,
            uint96[] memory stakingModuleFees,
            uint96 totalFee,
            uint256 precisionPoints
        )
    {
        (uint256 totalActiveValidators, StakingModuleCache[] memory stakingModulesCache) = _loadStakingModulesCache(false);
        uint256 stakingModulesCount = stakingModulesCache.length;

        /// @dev return empty response if there are no staking modules or active validators yet
        if (stakingModulesCount == 0 || totalActiveValidators == 0) {
            return (new address[](0), new uint256[](0), new uint96[](0), 0, FEE_PRECISION_POINTS);
        }

        precisionPoints = FEE_PRECISION_POINTS;
        stakingModuleIds = new uint256[](stakingModulesCount);
        recipients = new address[](stakingModulesCount);
        stakingModuleFees = new uint96[](stakingModulesCount);

        uint256 rewardedStakingModulesCount = 0;
        uint256 stakingModuleValidatorsShare;
        uint96 stakingModuleFee;

        for (uint256 i; i < stakingModulesCount; ) {
            stakingModuleIds[i] = stakingModulesCache[i].stakingModuleId;
            /// @dev skip staking modules which have no active validators
            if (stakingModulesCache[i].activeValidatorsCount > 0) {
                stakingModuleValidatorsShare = ((stakingModulesCache[i].activeValidatorsCount * precisionPoints) / totalActiveValidators);

                recipients[rewardedStakingModulesCount] = address(stakingModulesCache[i].stakingModuleAddress);
                stakingModuleFee = uint96((stakingModuleValidatorsShare * stakingModulesCache[i].stakingModuleFee) / TOTAL_BASIS_POINTS);
                /// @dev if the staking module has the `Stopped` status for some reason, then
                ///      the staking module's rewards go to the treasury, so that the DAO has ability
                ///      to manage them (e.g. to compensate the staking module in case of an error, etc.)
                if (stakingModulesCache[i].status != StakingModuleStatus.Stopped) {
                    stakingModuleFees[rewardedStakingModulesCount] = stakingModuleFee;
                }
                // else keep stakingModuleFees[rewardedStakingModulesCount] = 0, but increase totalFee

                totalFee += (uint96((stakingModuleValidatorsShare * stakingModulesCache[i].treasuryFee) / TOTAL_BASIS_POINTS) + stakingModuleFee);

                unchecked {
                    rewardedStakingModulesCount++;
                }
            }
            unchecked {
                ++i;
            }
        }

        // sanity check
        if (totalFee >= precisionPoints) revert ErrorValueOver100Percent("totalFee");

        /// @dev shrink arrays
        if (rewardedStakingModulesCount < stakingModulesCount) {
            uint256 trim = stakingModulesCount - rewardedStakingModulesCount;
            assembly {
                mstore(recipients, sub(mload(recipients), trim))
                mstore(stakingModuleFees, sub(mload(stakingModuleFees), trim))
            }
        }
    }

    /// @notice Helper for Lido contract (DEPRECATED)
    ///         Returns total fee total fee to mint for each staking
    ///         module and treasury in reduced, 1e4 precision.
    ///         In integrations please use getStakingRewardsDistribution().
    ///         reduced, 1e4 precision.
    function getTotalFeeE4Precision() external view returns (uint16 totalFee) {
        /// @dev The logic is placed here but in Lido contract to save Lido bytecode
        uint256 E4_BASIS_POINTS = 10000;  // Corresponds to Lido.TOTAL_BASIS_POINTS
        (, , , uint96 totalFeeInHighPrecision, uint256 precision) = getStakingRewardsDistribution();
        // Here we rely on (totalFeeInHighPrecision <= precision)
        totalFee = uint16((totalFeeInHighPrecision * E4_BASIS_POINTS) / precision);
    }

    /// @notice Helper for Lido contract (DEPRECATED)
    ///         Returns the same as getStakingFeeAggregateDistribution() but in reduced, 1e4 precision
    /// @dev Helper only for Lido contract. Use getStakingFeeAggregateDistribution() instead
    function getStakingFeeAggregateDistributionE4Precision()
        external view
        returns (uint16 modulesFee, uint16 treasuryFee)
    {
        /// @dev The logic is placed here but in Lido contract to save Lido bytecode
        uint256 E4_BASIS_POINTS = 10000;  // Corresponds to Lido.TOTAL_BASIS_POINTS
        (
            uint256 modulesFeeHighPrecision,
            uint256 treasuryFeeHighPrecision,
            uint256 precision
        ) = getStakingFeeAggregateDistribution();
        // Here we rely on ({modules,treasury}FeeHighPrecision <= precision)
        modulesFee = uint16((modulesFeeHighPrecision * E4_BASIS_POINTS) / precision);
        treasuryFee = uint16((treasuryFeeHighPrecision * E4_BASIS_POINTS) / precision);
    }

    /// @notice returns new deposits allocation after the distribution of the `_depositsCount` deposits
    function getDepositsAllocation(uint256 _depositsCount) external view returns (uint256 allocated, uint256[] memory allocations) {
        (allocated, allocations, ) = _getDepositsAllocation(_depositsCount);
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param _maxDepositsCount max deposits count
     * @param _stakingModuleId id of the staking module to be deposited
     * @param _depositCalldata staking module calldata
     */
    function deposit(
        uint256 _maxDepositsCount,
        uint256 _stakingModuleId,
        bytes calldata _depositCalldata
    ) external payable validStakingModuleId(_stakingModuleId)  returns (uint256 depositsCount) {
        if (msg.sender != LIDO_POSITION.getStorageAddress()) revert ErrorAppAuthLidoFailed();

        uint256 depositableEth = msg.value;
        if (depositableEth == 0) {
            _transferBalanceEthToLido();
            return 0;
        }

        bytes32 withdrawalCredentials = getWithdrawalCredentials();
        if (withdrawalCredentials == 0) revert ErrorEmptyWithdrawalsCredentials();

        uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        StakingModule storage stakingModule = _getStakingModuleByIndex(stakingModuleIndex);
        if (StakingModuleStatus(stakingModule.status) != StakingModuleStatus.Active) revert ErrorStakingModuleNotActive();

        uint256 maxDepositsCount = Math256.min(
            _maxDepositsCount,
            getStakingModuleMaxDepositsCount(_stakingModuleId)
        );

        if (maxDepositsCount > 0) {
            bytes memory publicKeysBatch;
            bytes memory signaturesBatch;
            (depositsCount, publicKeysBatch, signaturesBatch) = IStakingModule(stakingModule.stakingModuleAddress)
                .provideDepositsData(maxDepositsCount, _depositCalldata);

            if (depositsCount > 0) {
                _makeBeaconChainDeposits32ETH(depositsCount, abi.encodePacked(withdrawalCredentials), publicKeysBatch, signaturesBatch);

                stakingModule.lastDepositAt = uint64(block.timestamp);
                stakingModule.lastDepositBlock = block.number;

                emit StakingRouterETHDeposited(uint24(_stakingModuleId), depositsCount * DEPOSIT_SIZE);
            }
        }
        _transferBalanceEthToLido();
    }

    /// @dev transfer all remaining balance to Lido contract
    function _transferBalanceEthToLido() internal {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            getLido().receiveStakingRouterDepositRemainder{value: balance}();
        }
    }

    /**
     * @notice Set credentials to withdraw ETH on Consensus Layer side after the phase 2 is launched to `_withdrawalCredentials`
     * @dev Note that setWithdrawalCredentials discards all unused deposits data as the signatures are invalidated.
     * @param _withdrawalCredentials withdrawal credentials field as defined in the Ethereum PoS consensus specs
     */
    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external onlyRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE) {
        WITHDRAWAL_CREDENTIALS_POSITION.setStorageBytes32(_withdrawalCredentials);

        uint256 stakingModulesCount = getStakingModulesCount();
        for (uint256 i; i < stakingModulesCount; ) {
            IStakingModule(_getStakingModuleAddressByIndex(i)).invalidateDepositsData();
            unchecked {
                ++i;
            }
        }

        emit WithdrawalCredentialsSet(_withdrawalCredentials, msg.sender);
    }

    /**
     * @notice Returns current credentials to withdraw ETH on Consensus Layer side after the phase 2 is launched
     */
    function getWithdrawalCredentials() public view returns (bytes32) {
        return WITHDRAWAL_CREDENTIALS_POSITION.getStorageBytes32();
    }

    /**
     * @dev load modules into a memory cache
     *
     * @param _zeroValidatorsCountsOfInactiveModules if true, active and available validators for
     *        inactive modules are set to zero
     *
     * @return totalActiveValidators total active validators across all modules (excluding inactive
     *         if _zeroValidatorsCountsOfInactiveModules is true)
     * @return stakingModulesCache array of StakingModuleCache structs
     */
    function _loadStakingModulesCache(bool _zeroValidatorsCountsOfInactiveModules) internal view returns (
        uint256 totalActiveValidators,
        StakingModuleCache[] memory stakingModulesCache
    ) {
        uint256 stakingModulesCount = getStakingModulesCount();
        stakingModulesCache = new StakingModuleCache[](stakingModulesCount);
        for (uint256 i; i < stakingModulesCount; ) {
            stakingModulesCache[i] = _loadStakingModulesCacheItem(i, _zeroValidatorsCountsOfInactiveModules);
            totalActiveValidators += stakingModulesCache[i].activeValidatorsCount;
            unchecked {
                ++i;
            }
        }
    }

    function _loadStakingModulesCacheItem(
        uint256 _stakingModuleIndex,
        bool _zeroValidatorsCountsIfInactive
    ) internal view returns (StakingModuleCache memory cacheItem) {
        StakingModule storage stakingModuleData = _getStakingModuleByIndex(_stakingModuleIndex);

        cacheItem.stakingModuleAddress = stakingModuleData.stakingModuleAddress;
        cacheItem.stakingModuleId = stakingModuleData.id;
        cacheItem.stakingModuleFee = stakingModuleData.stakingModuleFee;
        cacheItem.treasuryFee = stakingModuleData.treasuryFee;
        cacheItem.targetShare = stakingModuleData.targetShare;
        cacheItem.status = StakingModuleStatus(stakingModuleData.status);

        if (!_zeroValidatorsCountsIfInactive || cacheItem.status == StakingModuleStatus.Active) {
            uint256 moduleExitedValidatorsCount;

            ValidatorsReport memory allValidatorsReport = 
                IStakingModule(cacheItem.stakingModuleAddress).getValidatorsReport();

            cacheItem.activeValidatorsCount = allValidatorsReport.totalDeposited - allValidatorsReport.totalExited;
            cacheItem.availableValidatorsCount = allValidatorsReport.totalVetted - allValidatorsReport.totalDeposited;

            uint256 exitedValidatorsCount = stakingModuleData.exitedValidatorsCount;
            if (exitedValidatorsCount > moduleExitedValidatorsCount) {
                // module hasn't received all exited validators data yet => we need to correct
                // activeValidatorsCount (equal to depositedValidatorsCount - exitedValidatorsCount) replacing
                // the exitedValidatorsCount with the one that staking router is aware of
                cacheItem.activeValidatorsCount -= (exitedValidatorsCount - moduleExitedValidatorsCount);
            }
        }
    }

    function _getDepositsAllocation(
        uint256 _depositsToAllocate
    ) internal view returns (uint256 allocated, uint256[] memory allocations, StakingModuleCache[] memory stakingModulesCache) {
        // calculate total used validators for operators
        uint256 totalActiveValidators;

        (totalActiveValidators, stakingModulesCache) = _loadStakingModulesCache(true);

        uint256 stakingModulesCount = stakingModulesCache.length;
        allocations = new uint256[](stakingModulesCount);
        if (stakingModulesCount > 0) {
            /// @dev new estimated active validators count
            totalActiveValidators += _depositsToAllocate;
            uint256[] memory capacities = new uint256[](stakingModulesCount);
            uint256 targetValidators;

            for (uint256 i; i < stakingModulesCount; ) {
                allocations[i] = stakingModulesCache[i].activeValidatorsCount;
                targetValidators = (stakingModulesCache[i].targetShare * totalActiveValidators) / TOTAL_BASIS_POINTS;
                capacities[i] = Math256.min(targetValidators, stakingModulesCache[i].activeValidatorsCount + stakingModulesCache[i].availableValidatorsCount);
                unchecked {
                    ++i;
                }
            }

            allocated = MinFirstAllocationStrategy.allocate(allocations, capacities, _depositsToAllocate);
        }
    }

    function _getStakingModuleIndexById(uint256 _stakingModuleId) internal view returns (uint256) {
        mapping(uint256 => uint256) storage _stakingModuleIndicesOneBased = _getStorageStakingIndicesMapping();
        uint256 indexOneBased = _stakingModuleIndicesOneBased[_stakingModuleId];
        if (indexOneBased == 0) revert ErrorStakingModuleUnregistered();
        return indexOneBased - 1;
    }

    function _setStakingModuleIndexById(uint256 _stakingModuleId, uint256 _stakingModuleIndex) internal {
        mapping(uint256 => uint256) storage _stakingModuleIndicesOneBased = _getStorageStakingIndicesMapping();
        _stakingModuleIndicesOneBased[_stakingModuleId] = _stakingModuleIndex + 1;
    }

    function _getStakingModuleById(uint256 _stakingModuleId) internal view returns (StakingModule storage) {
        return _getStakingModuleByIndex(_getStakingModuleIndexById(_stakingModuleId));
    }

    function _getStakingModuleByIndex(uint256 _stakingModuleIndex) internal view returns (StakingModule storage) {
        mapping(uint256 => StakingModule) storage _stakingModules = _getStorageStakingModulesMapping();
        return _stakingModules[_stakingModuleIndex];
    }

    function _getStakingModuleAddressById(uint256 _stakingModuleId) internal view returns (address) {
        return _getStakingModuleById(_stakingModuleId).stakingModuleAddress;
    }

    function _getStakingModuleAddressByIndex(uint256 _stakingModuleIndex) internal view returns (address) {
        return _getStakingModuleByIndex(_stakingModuleIndex).stakingModuleAddress;
    }


    function _getStorageStakingModulesMapping() internal pure returns (mapping(uint256 => StakingModule) storage result) {
        bytes32 position = STAKING_MODULES_MAPPING_POSITION;
        assembly {
            result.slot := position
        }
    }

    function _getStorageStakingIndicesMapping() internal pure returns (mapping(uint256 => uint256) storage result) {
        bytes32 position = STAKING_MODULE_INDICES_MAPPING_POSITION;
        assembly {
            result.slot := position
        }
    }
}
