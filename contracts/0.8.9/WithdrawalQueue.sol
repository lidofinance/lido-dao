// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {WithdrawalQueueBase} from "./WithdrawalQueueBase.sol";

import {IERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import {SafeCast} from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";
import {PausableUntil} from "./utils/PausableUntil.sol";

import {Versioned} from "./utils/Versioned.sol";

/// @notice Interface defining a Lido liquid staking pool
/// @dev see also [Lido liquid staking pool core contract](https://docs.lido.fi/contracts/lido)
interface IStETH is IERC20, IERC20Permit {
    function getSharesByPooledEth(uint256 _pooledEthAmount) external view returns (uint256);
}

/// @notice Interface defining a Lido liquid staking pool wrapper
/// @dev see WstETH.sol for full docs
interface IWstETH is IERC20, IERC20Permit {
    function unwrap(uint256 _wstETHAmount) external returns (uint256);
    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256);
    function stETH() external view returns (IStETH);
}

/// @title A contract for handling stETH withdrawal request queue within the Lido protocol
/// @author folkyatina
abstract contract WithdrawalQueue is AccessControlEnumerable, PausableUntil, WithdrawalQueueBase, Versioned {
    using SafeCast for uint256;
    using SafeERC20 for IWstETH;
    using SafeERC20 for IStETH;
    using UnstructuredStorage for bytes32;

    /// Bunker mode activation timestamp
    bytes32 internal constant BUNKER_MODE_SINCE_TIMESTAMP_POSITION =
        keccak256("lido.WithdrawalQueue.bunkerModeSinceTimestamp");
    /// Special value for timestamp when bunker mode is inactive (i.e., protocol in turbo mode)
    uint256 public constant BUNKER_MODE_DISABLED_TIMESTAMP = type(uint256).max;

    // ACL
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant FINALIZE_ROLE = keccak256("FINALIZE_ROLE");
    bytes32 public constant BUNKER_MODE_REPORT_ROLE = keccak256("BUNKER_MODE_REPORT_ROLE");

    /// @notice minimal possible sum that is possible to withdraw
    uint256 public constant MIN_STETH_WITHDRAWAL_AMOUNT = 100;

    /// @notice maximum possible sum that is possible to withdraw by a single request
    /// Prevents accumulating too much funds per single request fulfillment in the future.
    /// @dev To withdraw larger amounts, it's recommended to split it to several requests
    uint256 public constant MAX_STETH_WITHDRAWAL_AMOUNT = 1000 * 1e18;

    /// @notice Lido stETH token address to be set upon construction
    IStETH public immutable STETH;
    /// @notice Lido wstETH token address to be set upon construction
    IWstETH public immutable WSTETH;

    /// @notice Emitted when the contract initialized
    /// @param _admin provided admin address
    /// @param _caller initialization `msg.sender`
    event InitializedV1(address _admin, address _pauser, address _resumer, address _finalizer, address _caller);

    error AdminZeroAddress();
    error AlreadyInitialized();
    error Uninitialized();
    error Unimplemented();
    error RequestAmountTooSmall(uint256 _amountOfStETH);
    error RequestAmountTooLarge(uint256 _amountOfStETH);
    error InvalidReportTimestamp();
    error LengthsMismatch(uint256 _expectedLength, uint256 _actualLength);
    error RequestIdsNotSorted();

    /// @param _wstETH address of WstETH contract
    constructor(IWstETH _wstETH) {
        // init immutables
        WSTETH = _wstETH;
        STETH = WSTETH.stETH();
    }

    /// @notice Initialize the contract storage explicitly.
    /// @param _admin admin address that can change every role.
    /// @param _pauser address that will be able to pause the withdrawals
    /// @param _resumer address that will be able to resume the withdrawals after pause
    /// @param _finalizer address that can finalize requests in the queue
    /// @dev Reverts with `AdminZeroAddress()` if `_admin` equals to `address(0)`
    /// @dev NB! It's initialized in paused state by default and should be resumed explicitly to start
    function initialize(address _admin, address _pauser, address _resumer, address _finalizer) external {
        if (_admin == address(0)) revert AdminZeroAddress();

        _initialize(_admin, _pauser, _resumer, _finalizer);
    }

    /// @notice Resume withdrawal requests placement and finalization
    function resume() external whenPaused onlyRole(RESUME_ROLE) {
        _resume();
    }

    /// @notice Pause withdrawal requests placement and finalization. Claiming finalized requests will still be available
    /// @param _duration pause duration, seconds (use `PAUSE_INFINITELY` for unlimited)
    function pause(uint256 _duration) external onlyRole(PAUSE_ROLE) {
        _pause(_duration);
    }

    struct WithdrawalRequestInput {
        /// @notice Amount of the wstETH/StETH tokens that will be locked for withdrawal
        uint256 amount;
        /// @notice Address that will be able to manage or claim the request
        address owner;
    }

    /// @notice Request the sequence of stETH withdrawals according to passed `withdrawalRequestInputs` data
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.owner` is set to `address(0)`,
    ///  `msg.sender` will be used as owner.
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
                _checkWithdrawalRequestInput(_withdrawalRequestInputs[i].amount, _withdrawalRequestInputs[i].owner)
            );
        }
    }

    /// @notice Request the sequence of wstETH withdrawals according to passed `withdrawalRequestInputs` data
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.owner` is set to `address(0)`,
    ///  `msg.sender` will be used as owner.
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawalsWstETH(WithdrawalRequestInput[] calldata _withdrawalRequestInputs)
        public
        whenResumed
        returns (uint256[] memory requestIds)
    {
        requestIds = new uint256[](_withdrawalRequestInputs.length);
        for (uint256 i = 0; i < _withdrawalRequestInputs.length; ++i) {
            uint256 amountOfWstETH = _withdrawalRequestInputs[i].amount;
            address owner = _checkWithdrawalRequestInput(
                IWstETH(WSTETH).getStETHByWstETH(amountOfWstETH), _withdrawalRequestInputs[i].owner
            );
            requestIds[i] = _requestWithdrawalWstETH(amountOfWstETH, owner);
        }
    }

    struct PermitInput {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Request the sequence of stETH withdrawals according to passed `withdrawalRequestInputs`
    ///  using EIP-2612 Permit
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.owner` is set to `address(0)`,
    ///  `msg.sender` will be used as owner.
    /// @param _permit data required for the stETH.permit() method to set the allowance
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawalsWithPermit(
        WithdrawalRequestInput[] calldata _withdrawalRequestInputs,
        PermitInput calldata _permit
    ) external whenResumed returns (uint256[] memory requestIds) {
        STETH.permit(msg.sender, address(this), _permit.value, _permit.deadline, _permit.v, _permit.r, _permit.s);
        return requestWithdrawals(_withdrawalRequestInputs);
    }

    /// @notice Request the sequence of wstETH withdrawals according to passed `withdrawalRequestInputs` data
    ///  using EIP-2612 Permit
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.owner` is set to `address(0)`,
    ///  `msg.sender` will be used as owner.
    /// @param _permit data required for the wstETH.permit() method to set the allowance
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawalsWstETHWithPermit(
        WithdrawalRequestInput[] calldata _withdrawalRequestInputs,
        PermitInput calldata _permit
    ) external whenResumed returns (uint256[] memory requestIds) {
        WSTETH.permit(msg.sender, address(this), _permit.value, _permit.deadline, _permit.v, _permit.r, _permit.s);
        return requestWithdrawalsWstETH(_withdrawalRequestInputs);
    }

    /// @notice return statuses for the bunch of requests
    /// @param _requestIds list of withdrawal request ids and hints to claim
    function getWithdrawalRequestStatuses(uint256[] calldata _requestIds)
        external
        view
        returns (WithdrawalRequestStatus[] memory statuses)
    {
        statuses = new WithdrawalRequestStatus[](_requestIds.length);
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            statuses[i] = getWithdrawalRequestStatus(_requestIds[i]);
        }
    }

    struct ClaimWithdrawalInput {
        /// @notice id of the finalized requests to claim
        uint256 requestId;
        /// @notice rate index that should be used for claiming
        uint256 hint;
    }

    /// @notice Claim withdrawals batch once finalized (claimable).
    /// @param _claimWithdrawalInputs list of withdrawal request ids and hints to claim
    function claimWithdrawals(ClaimWithdrawalInput[] calldata _claimWithdrawalInputs) external {
        for (uint256 i = 0; i < _claimWithdrawalInputs.length; ++i) {
            _claimWithdrawalTo(_claimWithdrawalInputs[i].requestId, _claimWithdrawalInputs[i].hint, msg.sender);
            _emitTransfer(msg.sender, address(0), _claimWithdrawalInputs[i].requestId);
        }
    }

    ///  @notice Claim `_requestId` request and transfer locked ether to the owner
    ///  @param _requestId request id to claim
    ///  @param _hint hint for checkpoint index to avoid extensive search over the checkpointHistory.
    ///   Can be retrieved with `findClaimHint()` or `findClaimHintUnbounded()`
    /// @param _recipient address where claimed ether will be sent to
    function claimWithdrawalTo(uint256 _requestId, uint256 _hint, address _recipient) external {
        _claimWithdrawalTo(_requestId, _hint, _recipient);
        _emitTransfer(msg.sender, address(0), _requestId);
    }

    /// @notice Claim `_requestId` request and transfer locked ether to the owner
    /// @param _requestId request id to claim
    /// @dev will use `findClaimHintUnbounded()` to find a hint, what can lead to OOG
    /// Prefer `claimWithdrawal(uint256 _requestId, uint256 _hint)` to save gas
    function claimWithdrawal(uint256 _requestId) external {
        _claimWithdrawalTo(_requestId, findClaimHintUnbounded(_requestId), msg.sender);
        _emitTransfer(msg.sender, address(0), _requestId);
    }

    /// @notice Finds the list of hints for the given `_requestIds` searching among the checkpoints with indices
    ///  in the range  `[_firstIndex, _lastIndex]`
    /// @param _requestIds ids of the requests sorted in the ascending order to get hints for
    /// @param _firstIndex left boundary of the search range
    /// @param _lastIndex right boundary of the search range
    /// @return hintIds the hints for `claimWithdrawal` to find the checkpoint for the passed request ids
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

    /// @notice Finds the list of hints for the given `_requestIds` searching among the checkpoints with indices
    ///  in the range `[1, lastCheckpointIndex]`
    /// @dev WARNING! OOG is possible if used onchain.
    ///  See `findClaimHints(uint256[] calldata _requestIds, uint256 _firstIndex, uint256 _lastIndex)` for onchain use
    /// @param _requestIds ids of the requests sorted in the ascending order to get hints for
    function findClaimHintsUnbounded(uint256[] calldata _requestIds) public view returns (uint256[] memory hintIds) {
        return findClaimHints(_requestIds, 1, getLastCheckpointIndex());
    }

    /// @notice Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
    /// @dev ether to finalize all the requests should be calculated using `finalizationBatch()` and sent along
    ///
    /// @param _nextFinalizedRequestId request index in the queue that will be last finalized request in a batch
    function finalize(uint256 _nextFinalizedRequestId) external payable whenResumed onlyRole(FINALIZE_ROLE) {
        _finalize(_nextFinalizedRequestId, msg.value.toUint128());
    }

    /// @notice Update bunker mode state
    /// @dev should be called by oracle
    ///
    /// @param _isBunkerModeNow oracle report
    /// @param _bunkerModeSinceTimestamp timestamp of start of the bunker mode
    function updateBunkerMode(bool _isBunkerModeNow, uint256 _bunkerModeSinceTimestamp)
        external
        onlyRole(BUNKER_MODE_REPORT_ROLE)
    {
        if (_bunkerModeSinceTimestamp >= block.timestamp) revert InvalidReportTimestamp();

        bool isBunkerModeWasSetBefore = isBunkerModeActive();

        // on bunker mode state change
        if (_isBunkerModeNow != isBunkerModeWasSetBefore) {
            // write previous timestamp to enable bunker or max uint to disable
            uint256 newTimestamp = _isBunkerModeNow ? _bunkerModeSinceTimestamp : BUNKER_MODE_DISABLED_TIMESTAMP;
            BUNKER_MODE_SINCE_TIMESTAMP_POSITION.setStorageUint256(newTimestamp);
        }
    }

    /// @notice Check if bunker mode is active
    function isBunkerModeActive() public view returns (bool) {
        return bunkerModeSinceTimestamp() < BUNKER_MODE_DISABLED_TIMESTAMP;
    }

    /// @notice Get bunker mode activation timestamp
    /// @dev returns `BUNKER_MODE_DISABLED_TIMESTAMP` if bunker mode is disable (i.e., protocol in turbo mode)
    function bunkerModeSinceTimestamp() public view returns (uint256) {
        return BUNKER_MODE_SINCE_TIMESTAMP_POSITION.getStorageUint256();
    }

    /// @notice Should emit ERC721 Transfer event in the inheriting contract
    function _emitTransfer(address from, address to, uint256 _requestId) internal virtual;

    /// @dev internal initialization helper. Doesn't check provided addresses intentionally
    function _initialize(address _admin, address _pauser, address _resumer, address _finalizer) internal {
        _initializeQueue();

        _initializeContractVersionTo(1);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAUSE_ROLE, _pauser);
        _grantRole(RESUME_ROLE, _resumer);
        _grantRole(FINALIZE_ROLE, _finalizer);

        RESUME_SINCE_TIMESTAMP_POSITION.setStorageUint256(PAUSE_INFINITELY); // pause it explicitly
        BUNKER_MODE_SINCE_TIMESTAMP_POSITION.setStorageUint256(BUNKER_MODE_DISABLED_TIMESTAMP);

        emit InitializedV1(_admin, _pauser, _resumer, _finalizer, msg.sender);
    }

    function _requestWithdrawal(uint256 _amountOfStETH, address _owner) internal returns (uint256 requestId) {
        STETH.safeTransferFrom(msg.sender, address(this), _amountOfStETH);

        uint256 amountOfShares = STETH.getSharesByPooledEth(_amountOfStETH);

        requestId = _enqueue(_amountOfStETH.toUint128(), amountOfShares.toUint128(), _owner);

        _emitTransfer(address(0), _owner, requestId);
    }

    function _requestWithdrawalWstETH(uint256 _amountOfWstETH, address _owner) internal returns (uint256 requestId) {
        WSTETH.safeTransferFrom(msg.sender, address(this), _amountOfWstETH);
        uint256 amountOfStETH = IWstETH(WSTETH).unwrap(_amountOfWstETH);

        uint256 amountOfShares = STETH.getSharesByPooledEth(amountOfStETH);

        requestId = _enqueue(amountOfStETH.toUint128(), amountOfShares.toUint128(), _owner);

        _emitTransfer(address(0), _owner, requestId);
    }

    function _checkWithdrawalRequestInput(uint256 _amountOfStETH, address _owner) internal view returns (address) {
        if (_amountOfStETH < MIN_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooSmall(_amountOfStETH);
        }
        if (_amountOfStETH > MAX_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooLarge(_amountOfStETH);
        }
        if (_owner == address(0)) {
            _owner = msg.sender;
        }

        return _owner;
    }
}
