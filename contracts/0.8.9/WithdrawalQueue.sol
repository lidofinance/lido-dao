// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {WithdrawalQueueBase} from "./WithdrawalQueueBase.sol";

import {IERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import {IERC20Permit} from "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";

import {Versioned} from "./utils/Versioned.sol";

/**
 * @title Interface defining a Lido liquid staking pool
 * @dev see also [Lido liquid staking pool core contract](https://docs.lido.fi/contracts/lido)
 */
interface IStETH is IERC20, IERC20Permit {
    /**
     * @notice Get shares amount by the stETH token amount
     * @param _pooledEthAmount stETH token amount
     */
    function getSharesByPooledEth(uint256 _pooledEthAmount) external view returns (uint256);
}

interface IWstETH is IERC20, IERC20Permit {
    /**
     * @notice Exchanges wstETH to stETH
     * @param _wstETHAmount amount of wstETH to unwrap in exchange for stETH
     * @return Amount of stETH user receives after unwrap
     */
    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    /**
     * @notice Get amount of stETH for a given amount of wstETH
     * @param _wstETHAmount amount of wstETH
     * @return Amount of stETH for a given wstETH amount
     */
    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256);

    /**
     * @notice Returns a contract that this implementation of WstETH is a wrapper for
     */
    function stETH() external view returns (IStETH);
}

/**
 * @title A contract for handling stETH withdrawal request queue within the Lido protocol
 * @author folkyatina
 */
contract WithdrawalQueue is AccessControlEnumerable, WithdrawalQueueBase, Versioned {
    using SafeERC20 for IWstETH;
    using SafeERC20 for IStETH;
    using UnstructuredStorage for bytes32;

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///  Inherited from WithdrawalQueueBase:
    ///! SLOT 0: mapping(uint256 => WithdrawalRequest) queue
    ///! SLOT 1: uint256 lastRequestId
    ///! SLOT 2: uint256 lastFinalizedRequestId
    ///! SLOT 3: mapping(uint256 => Discount) discountHistory
    ///! SLOT 4: uint256 lastDiscountIndex
    ///! SLOT 5: uint128 public lockedEtherAmount
    ///! SLOT 6: mapping(address => uint256[]) requestsByRecipient

    /// Withdrawal queue resume/pause control storage slot
    bytes32 public constant RESUME_SINCE_TIMESTAMP_POSITION = keccak256("lido.WithdrawalQueue.resumeSinceTimestamp");
    /// Special value for the infinite pause
    uint256 public constant PAUSE_INFINITELY = type(uint256).max;
    /// Bunker mode activation timestamp
    bytes32 public constant BUNKER_MODE_SINCE_TIMESTAMP_POSITION = keccak256("lido.WithdrawalQueue.bunkerModeSinceTimestamp");
    /// Special value for timestamp when bunker mode is inactive (i.e., protocol in turbo mode)
    uint256 public constant BUNKER_MODE_DISABLED_TIMESTAMP = type(uint256).max;

    // ACL
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant FINALIZE_ROLE = keccak256("FINALIZE_ROLE");
    bytes32 public constant BUNKER_MODE_REPORT_ROLE = keccak256("BUNKER_MODE_REPORT_ROLE");

    /// @notice minimal possible sum that is possible to withdraw
    uint256 public constant MIN_STETH_WITHDRAWAL_AMOUNT = 100;

    /**
     * @notice maximum possible sum that is possible to withdraw by a single request
     * Prevents accumulating too much funds per single request fulfillment in the future.
     * @dev To withdraw larger amounts, it's recommended to split it to several requests
     */
    uint256 public constant MAX_STETH_WITHDRAWAL_AMOUNT = 1000 * 1e18;

    /// @notice Lido stETH token address to be set upon construction
    IStETH public immutable STETH;
    /// @notice Lido wstETH token address to be set upon construction
    IWstETH public immutable WSTETH;

    /// @notice Emitted when withdrawal requests placement and finalization paused by the `pause(duration)` call
    event Paused(uint256 duration);
    /// @notice Emitted when withdrawal requests placement and finalization resumed by the `resume` call
    event Resumed();
    /// @notice Emitted when the contract initialized
    /// @param _admin provided admin address
    /// @param _caller initialization `msg.sender`
    event InitializedV1(address _admin, address _pauser, address _resumer, address _finalizer, address _caller);

    error AdminZeroAddress();
    error AlreadyInitialized();
    error Uninitialized();
    error Unimplemented();
    error PausedExpected();
    error ResumedExpected();
    error RequestAmountTooSmall(uint256 _amountOfStETH);
    error RequestAmountTooLarge(uint256 _amountOfStETH);
    error InvalidReportTimestamp();
    error LengthsMismatch(uint256 _expectedLength, uint256 _actualLength);
    error RequestIdsNotSorted();
    error ZeroPauseDuration();

    /// @notice Reverts when the contract is uninitialized
    modifier whenInitialized() {
        if (CONTRACT_VERSION_POSITION.getStorageUint256() == 0) {
            revert Uninitialized();
        }
        _;
    }

    /// @notice Reverts when new withdrawal requests placement and finalization resumed
    modifier whenPaused() {
        if (block.timestamp >= RESUME_SINCE_TIMESTAMP_POSITION.getStorageUint256()) {
            revert PausedExpected();
        }
        _;
    }

    /// @notice Reverts when new withdrawal requests placement and finalization paused
    modifier whenResumed() {
        if (block.timestamp < RESUME_SINCE_TIMESTAMP_POSITION.getStorageUint256()) {
            revert ResumedExpected();
        }
        _;
    }

    /**
     * @param _wstETH address of WstETH contract
     */
    constructor(IWstETH _wstETH) {
        // init immutables
        WSTETH = _wstETH;
        STETH = WSTETH.stETH();
    }

    /**
     * @notice Intialize the contract storage explicitly.
     * @param _admin admin address that can change every role.
     * @param _pauser address that will be able to pause the withdrawals
     * @param _resumer address that will be able to resume the withdrawals after pause
     * @param _finalizer address that can finalize requests in the queue
     * @dev Reverts with `AdminZeroAddress()` if `_admin` equals to `address(0)`
     * @dev NB! It's initialized in paused state by default and should be resumed explicitly to start
     */
    function initialize(address _admin, address _pauser, address _resumer, address _finalizer) external {
        if (_admin == address(0)) {
            revert AdminZeroAddress();
        }

        _initialize(_admin, _pauser, _resumer, _finalizer);
    }

    /// @notice Returns whether the contract is initialized or not
    function isInitialized() external view returns (bool) {
        return getContractVersion() != 0;
    }

    /**
     * @notice Resume withdrawal requests placement and finalization
     * @dev Reverts with `Uninitialized()` if contract is not initialized
     * @dev Reverts with `PausedExpected()` if contract is already resumed
     * @dev Reverts with `AccessControl:...` reason if sender has no `RESUME_ROLE`
     */
    function resume() external whenInitialized whenPaused onlyRole(RESUME_ROLE) {
        RESUME_SINCE_TIMESTAMP_POSITION.setStorageUint256(block.timestamp);

        emit Resumed();
    }

    /**
     * @notice Pause withdrawal requests placement and finalization. Claiming finalized requests will still be available
     * @param _duration pause duration, seconds (use `PAUSE_INFINITELY` for unlimited)
     * @dev Reverts with `ResumedExpected()` if contract is already paused
     * @dev Reverts with `AccessControl:...` reason if sender has no `PAUSE_ROLE`
     * @dev Reverts with `ZeroPauseDuration()` if zero duration is passed
     */
    function pause(uint256 _duration) external whenResumed onlyRole(PAUSE_ROLE) {
        if (_duration == 0) { revert ZeroPauseDuration(); }

        uint256 pausedUntill;
        if (_duration == PAUSE_INFINITELY) {
            pausedUntill = PAUSE_INFINITELY;
        } else {
            pausedUntill = block.timestamp + _duration;
        }

        RESUME_SINCE_TIMESTAMP_POSITION.setStorageUint256(pausedUntill);

        emit Paused(_duration);
    }

    /// @notice Returns whether the requests placement and finalization is paused or not
    function isPaused() external view returns (bool) {
        return block.timestamp < RESUME_SINCE_TIMESTAMP_POSITION.getStorageUint256();
    }

    struct WithdrawalRequestInput {
        /// @notice Amount of the wstETH/StETH tokens that will be locked for withdrawal
        uint256 amount;
        /// @notice Address to send ether to upon withdrawal
        address recipient;
    }

    /// @notice Request the sequence of stETH withdrawals according to passed `withdrawalRequestInputs` data
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.recipient` is set to `address(0)`,
    ///  `msg.sender` will be used as recipient.
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawals(WithdrawalRequestInput[] calldata _withdrawalRequestInputs)
        public
        whenResumed
        returns (uint256[] memory requestIds)
    {
        requestIds = new uint256[](_withdrawalRequestInputs.length);
        for (uint256 i = 0; i < _withdrawalRequestInputs.length; ++i) {
            requestIds[i] = _requestWithdrawal(
                _withdrawalRequestInputs[i].amount,
                _checkWithdrawalRequestInput(_withdrawalRequestInputs[i].amount, _withdrawalRequestInputs[i].recipient)
            );
        }
    }

    /// @notice Request the sequence of wstETH withdrawals according to passed `withdrawalRequestInputs` data
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.recipient` is set to `address(0)`,
    ///  `msg.sender` will be used as recipient.
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawalsWstETH(WithdrawalRequestInput[] calldata _withdrawalRequestInputs)
        public
        whenResumed
        returns (uint256[] memory requestIds)
    {
        requestIds = new uint256[](_withdrawalRequestInputs.length);
        for (uint256 i = 0; i < _withdrawalRequestInputs.length; ++i) {
            uint256 amountOfWstETH = _withdrawalRequestInputs[i].amount;
            address recipient = _checkWithdrawalRequestInput(
                IWstETH(WSTETH).getStETHByWstETH(amountOfWstETH),
                _withdrawalRequestInputs[i].recipient
            );
            requestIds[i] = _requestWithdrawalWstETH(amountOfWstETH, recipient);
        }
    }

    struct Permit {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Request the sequence of stETH withdrawals according to passed `withdrawalRequestInputs` data using EIP-2612 Permit
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.recipient` is set to `address(0)`,
    ///  `msg.sender` will be used as recipient.
    /// @param _permit data required for the stETH.permit() method to set the allowance
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawalsWithPermit(
        WithdrawalRequestInput[] calldata _withdrawalRequestInputs,
        Permit calldata _permit
    ) external whenResumed returns (uint256[] memory requestIds) {
        STETH.permit(msg.sender, address(this), _permit.value, _permit.deadline, _permit.v, _permit.r, _permit.s);
        return requestWithdrawals(_withdrawalRequestInputs);
    }

    /// @notice Request the sequence of wstETH withdrawals according to passed `withdrawalRequestInputs` data using EIP-2612 Permit
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.recipient` is set to `address(0)`,
    ///  `msg.sender` will be used as recipient.
    /// @param _permit data required for the wstETH.permit() method to set the allowance
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawalsWstETHWithPermit(
        WithdrawalRequestInput[] calldata _withdrawalRequestInputs,
        Permit calldata _permit
    ) external whenResumed returns (uint256[] memory requestIds) {
        WSTETH.permit(msg.sender, address(this), _permit.value, _permit.deadline, _permit.v, _permit.r, _permit.s);
        return requestWithdrawalsWstETH(_withdrawalRequestInputs);
    }

    struct ClaimWithdrawalInput {
        /// @notice id of the finalized requests to claim
        uint256 requestId;
        /// @notice rate index that should be used for claiming
        uint256 hint;
    }

    /// @notice Claim withdrawals batch once finalized (claimable)
    /// @param _claimWithdrawalInputs list of withdrawal request ids and hints to claim
    function claimWithdrawals(ClaimWithdrawalInput[] calldata _claimWithdrawalInputs) external {
        for (uint256 i = 0; i < _claimWithdrawalInputs.length; ++i) {
            claimWithdrawal(_claimWithdrawalInputs[i].requestId, _claimWithdrawalInputs[i].hint);
        }
    }

    /// @notice Finds the list of hints for the given `_requestIds` searching among the discounts with indices
    ///  in the range  `[_firstIndex, _lastIndex]`
    /// @param _requestIds ids of the requests sorted in the ascending order to get hints for
    /// @param _firstIndex left boundary of the search range
    /// @param _lastIndex right boundary of the search range
    /// @return hintIds the hints for `claimWithdrawal` to find the discount for the passed request ids
    function findClaimHints(uint256[] calldata _requestIds, uint256 _firstIndex, uint256 _lastIndex)
        public
        view
        returns (uint256[] memory hintIds)
    {
        hintIds = new uint256[](_requestIds.length);
        uint256 prevRequestId = 0;
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            if (_requestIds[i] < prevRequestId) revert RequestIdsNotSorted();
            hintIds[i] = findClaimHint(_requestIds[i], _firstIndex, _lastIndex);
            _firstIndex = hintIds[i];
            prevRequestId = _requestIds[i];
        }
    }

    /// @notice Finds the list of hints for the given `_requestIds` searching among the discounts with indices
    ///  in the range `[0, lastDiscountIndex]`
    /// @dev WARNING! OOG is possible if used onchain.
    ///  See `findClaimHints(uint256[] calldata _requestIds, uint256 _firstIndex, uint256 _lastIndex)` for onchain use
    /// @param _requestIds ids of the requests sorted in the ascending order to get hints for
    function findClaimHintsUnbounded(uint256[] calldata _requestIds) public view returns (uint256[] memory hintIds) {
        return findClaimHints(_requestIds, 0, lastDiscountIndex);
    }

    /**
     * @notice Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
     * @dev ether to finalize all the requests should be calculated using `finalizationBatch()` and sent along
     *
     * @param _lastRequestIdToFinalize request index in the queue that will be last finalized request in a batch
     */
    function finalize(uint256 _lastRequestIdToFinalize) external payable whenResumed onlyRole(FINALIZE_ROLE) {
        _finalize(_lastRequestIdToFinalize, msg.value);
    }

    /**
     * @notice Update bunker mode state
     * @dev should be called by oracle
     *
     * NB: timestamp should correspond to the previous oracle report
     *
     * @param _previousOracleReportTimestamp timestamp of the previous oracle report
     * @param _isBunkerModeNow oracle report
     */
    function updateBunkerMode(
        uint256 _previousOracleReportTimestamp,
        bool _isBunkerModeNow
    ) external onlyRole(BUNKER_MODE_REPORT_ROLE) {
        if (_previousOracleReportTimestamp >= block.timestamp) { revert InvalidReportTimestamp(); }

        bool isBunkerModeWasSetBefore = isBunkerModeActive();

        // on bunker mode state change
        if (_isBunkerModeNow != isBunkerModeWasSetBefore) {
            // write previous timestamp to enable bunker or max uint to disable
            uint256 newTimestamp = _isBunkerModeNow ? _previousOracleReportTimestamp : BUNKER_MODE_DISABLED_TIMESTAMP;
            BUNKER_MODE_SINCE_TIMESTAMP_POSITION.setStorageUint256(newTimestamp);
        }
    }

    /**
     * @notice Check if bunker mode is active
     */
    function isBunkerModeActive() public view returns (bool) {
        return bunkerModeSinceTimestamp() < BUNKER_MODE_DISABLED_TIMESTAMP;
    }

    /**
     * @notice Get bunker mode activation timestamp
     * @dev returns `BUNKER_MODE_DISABLED_TIMESTAMP` if bunker mode is disable (i.e., protocol in turbo mode)
     */
    function bunkerModeSinceTimestamp() public view returns (uint256) {
        return BUNKER_MODE_SINCE_TIMESTAMP_POSITION.getStorageUint256();
    }

    /// @dev internal initialization helper. Doesn't check provided addresses intentionally
    function _initialize(address _admin, address _pauser, address _resumer, address _finalizer) internal {
        _initializeQueue();

        _initializeContractVersionTo(1);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAUSE_ROLE, _pauser);
        _grantRole(RESUME_ROLE, _resumer);
        _grantRole(FINALIZE_ROLE, _finalizer);

        RESUME_SINCE_TIMESTAMP_POSITION.setStorageUint256(PAUSE_INFINITELY); // pause it explicitly

        emit InitializedV1(_admin, _pauser, _resumer, _finalizer, msg.sender);
    }

    function _requestWithdrawal(uint256 _amountOfStETH, address _recipient) internal returns (uint256 requestId) {
        STETH.safeTransferFrom(msg.sender, address(this), _amountOfStETH);

        uint256 amountOfShares = STETH.getSharesByPooledEth(_amountOfStETH);

        return _enqueue(_amountOfStETH, amountOfShares, _recipient);
    }

    function _requestWithdrawalWstETH(uint256 _amountOfWstETH, address _recipient)
        internal
        returns (uint256 requestId)
    {
        WSTETH.safeTransferFrom(msg.sender, address(this), _amountOfWstETH);
        uint256 amountOfStETH = IWstETH(WSTETH).unwrap(_amountOfWstETH);

        uint256 amountOfShares = STETH.getSharesByPooledEth(amountOfStETH);

        return _enqueue(amountOfStETH, amountOfShares, _recipient);
    }

    function _checkWithdrawalRequestInput(uint256 _amountOfStETH, address _recipient) internal view returns (address) {
        if (_amountOfStETH < MIN_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooSmall(_amountOfStETH);
        }
        if (_amountOfStETH > MAX_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooLarge(_amountOfStETH);
        }
        if (_recipient == address(0)) {
            _recipient = msg.sender;
        }

        return _recipient;
    }
}
