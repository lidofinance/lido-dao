// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import {IERC20Permit} from "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

import {WithdrawalQueueBase} from "./WithdrawlQueueBase.sol";

import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";

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
     * @dev Requirements:
     *  - `_wstETHAmount` must be non-zero
     *  - msg.sender must have at least `_wstETHAmount` wstETH.
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
 * @title A contract for handling stETH withdrawal request queue within Lido protocol
 * @author folkyatina
 */
contract WithdrawalQueue is AccessControlEnumerable, WithdrawalQueueBase {
    using SafeERC20 for IWstETH;
    using SafeERC20 for IStETH;
    using UnstructuredStorage for bytes32;

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///  Inherited from AccessControlEnumerable:
    ///! SLOT 0: mapping(bytes32 => RoleData) _roles
    ///! SLOT 1: mapping(bytes32 => EnumerableSet.AddressSet) _roleMembers
    ///  Inherited from WithdrawalQueueBase:
    ///! SLOT 2: mapping(uint256 => WithdrawalRequest) queue
    ///! SLOT 3: uint256 lastRequestId
    ///! SLOT 4: uint256 lastFinalizedRequestId
    ///! SLOT 5: mapping(uint256 => Discount) discountHistory
    ///! SLOT 6: uint256 lastDiscountIndex
    ///! SLOT 7: uint128 public lockedEtherAmount
    ///! SLOT 8: mapping(address => uint256[]) requestsByRecipient

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.WithdrawalQueue.contractVersion");
    /// Withdrawal queue resume/pause control storage slot
    bytes32 internal constant RESUMED_POSITION = keccak256("lido.WithdrawalQueue.resumed");

    // ACL
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant FINALIZE_ROLE = keccak256("FINALIZE_ROLE");

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

    /// @notice Emitted when withdrawal requests placement paused
    event WithdrawalQueuePaused();
    /// @notice Emitted when withdrawal requests placement resumed
    event WithdrawalQueueResumed();
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
    error LengthsMismatch(uint256 _expectedLength, uint256 _actualLength);
    error UnsupportedWithdrawalToken(address _token, address[] _supportedTokens);

    /// @notice Reverts when the contract is uninitialized
    modifier whenInitialized() {
        if (CONTRACT_VERSION_POSITION.getStorageUint256() == 0) {
            revert Uninitialized();
        }
        _;
    }

    /// @notice Reverts when new withdrawal requests placement resumed
    modifier whenPaused() {
        if (RESUMED_POSITION.getStorageBool()) {
            revert PausedExpected();
        }
        _;
    }

    /// @notice Reverts when new withdrawal requests placement paused
    modifier whenResumed() {
        if (!RESUMED_POSITION.getStorageBool()) {
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

        // petrify the implementation by assigning a zero address for every role
        _initialize(address(0), address(0), address(0), address(0));
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
        return CONTRACT_VERSION_POSITION.getStorageUint256() != 0;
    }

    /**
     * @notice Resume withdrawal requests placement and finalization
     * @dev Reverts with `Uninitialized()` if contract is not initialized
     * @dev Reverts with `PausedExpected()` if contract is already resumed
     * @dev Reverts with `AccessControl:...` reason if sender has no `RESUME_ROLE`
     */
    function resume() external whenInitialized whenPaused onlyRole(RESUME_ROLE) {
        RESUMED_POSITION.setStorageBool(true);

        emit WithdrawalQueueResumed();
    }

    /**
     * @notice Pause withdrawal requests placement and finalization. Claiming finalized requests will still be available
     * @dev Reverts with `ResumedExpected()` if contract is already paused
     * @dev Reverts with `AccessControl:...` reason if sender has no `PAUSE_ROLE`
     */
    function pause() external whenResumed onlyRole(PAUSE_ROLE) {
        RESUMED_POSITION.setStorageBool(false);

        emit WithdrawalQueuePaused();
    }

    /// @notice Returns whether the requests placement and finalization is paused or not
    function isPaused() external view returns (bool) {
        return !RESUMED_POSITION.getStorageBool();
    }

    /**
     * @notice Request withdrawal of the provided stETH token amount
     * @param _amountOfStETH StETH tokens that will be locked for withdrawal
     * @param _recipient address to send ether to upon withdrawal. Will be set to `msg.sender` if `address(0)` is passed
     * @dev Reverts with `ResumedExpected()` if contract is paused
     * @dev Reverts with `RequestAmountTooSmall(_amountOfStETH)` if amount is less than `MIN_STETH_WITHDRAWAL_AMOUNT`
     * @dev Reverts with `RequestAmountTooLarge(_amountOfStETH)` if amount is greater than `MAX_STETH_WITHDRAWAL_AMOUNT`
     * @dev Reverts if failed to transfer StETH to the contract
     */
    function requestWithdrawal(uint256 _amountOfStETH, address _recipient)
        external
        whenResumed
        returns (uint256 requestId)
    {
        _recipient = _checkWithdrawalRequestInput(_amountOfStETH, _recipient);

        return _requestWithdrawal(_amountOfStETH, _recipient);
    }

    /**
     * @notice Request withdrawal of the provided stETH token amount using EIP-2612 Permit
     * @param _amountOfStETH StETH tokens that will be locked for withdrawal
     * @param _recipient address to send ether to upon withdrawal. Will be set to `msg.sender` if `address(0)` is passed
     */
    function requestWithdrawalWithPermit(
        uint256 _amountOfStETH,
        address _recipient,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external whenResumed returns (uint256 requestId) {
        _recipient = _checkWithdrawalRequestInput(_amountOfStETH, _recipient);

        STETH.permit(msg.sender, address(this), _amountOfStETH, _deadline, _v, _r, _s);

        return _requestWithdrawal(_amountOfStETH, _recipient);
    }

    /**
     * @notice Request withdrawal of the provided wstETH token amount
     * @param _amountOfWstETH StETH tokens that will be locked for withdrawal
     * @param _recipient address to send ether to upon withdrawal. Will be set to `msg.sender` if `address(0)` is passed
     */
    function requestWithdrawalWstETH(uint256 _amountOfWstETH, address _recipient)
        external
        whenResumed
        returns (uint256 requestId)
    {
        _recipient = _checkWithdrawalRequestInput(IWstETH(WSTETH).getStETHByWstETH(_amountOfWstETH), _recipient);
        return _requestWithdrawalWstETH(_amountOfWstETH, _recipient);
    }

    /**
     * @notice Request withdrawal of the provided wstETH token amount using EIP-2612 Permit
     * @param _amountOfWstETH StETH tokens that will be locked for withdrawal
     * @param _recipient address to send ether to upon withdrawal. Will be set to `msg.sender` if `address(0)` is passed
     */
    function requestWithdrawalWstETHWithPermit(
        uint256 _amountOfWstETH,
        address _recipient,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external whenResumed returns (uint256 requestId) {
        _recipient = _checkWithdrawalRequestInput(IWstETH(WSTETH).getStETHByWstETH(_amountOfWstETH), _recipient);
        WSTETH.permit(msg.sender, address(this), _amountOfWstETH, _deadline, _v, _r, _s);
        return _requestWithdrawalWstETH(_amountOfWstETH, _recipient);
    }

    struct WithdrawalRequestInput {
        address token;
        uint256 amount;
        address recipient;
    }

    /// @notice Request the sequence of withdrawals according to passed `withdrawalRequestInputs` data
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.recipient` is set to `address(0)`,
    ///  `msg.sender` will be used as recipient.
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawals(WithdrawalRequestInput[] memory _withdrawalRequestInputs)
        external
        whenResumed
        returns (uint256[] memory requestIds)
    {
        requestIds = new uint256[](_withdrawalRequestInputs.length);
        for (uint256 i = 0; i < _withdrawalRequestInputs.length; ++i) {
            requestIds[i] = _enqueueWithdrawalRequest(msg.sender, _withdrawalRequestInputs[i]);
        }
    }

    struct Permit {
        uint8 v;
        bytes32 r;
        bytes32 s;
        address owner;
        uint256 deadline;
    }

    /// @notice Request the sequence of withdrawals according to passed `withdrawalRequestInputs` data using EIP-2612 Permit
    /// @param _withdrawalRequestInputs an array of `WithdrawalRequestInput` data. The standalone withdrawal request will
    ///  be created for each item in the passed list. If `WithdrawalRequestInput.recipient` is set to `address(0)`,
    ///  `msg.sender` will be used as recipient.
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawalsWithPermit(
        WithdrawalRequestInput[] memory _withdrawalRequestInputs,
        Permit[] memory _permits
    ) external whenResumed returns (uint256[] memory requestIds) {
        if (_withdrawalRequestInputs.length != _permits.length)
            revert LengthsMismatch(_withdrawalRequestInputs.length, _permits.length);
        requestIds = new uint256[](_withdrawalRequestInputs.length);
        for (uint256 i = 0; i < _withdrawalRequestInputs.length; ++i) {
            IERC20Permit(_withdrawalRequestInputs[i].token).permit(
                _permits[i].owner,
                address(this),
                _withdrawalRequestInputs[i].amount,
                _permits[i].deadline,
                _permits[i].v,
                _permits[i].r,
                _permits[i].s
            );
            requestIds[i] = _enqueueWithdrawalRequest(_permits[i].owner, _withdrawalRequestInputs[i]);
        }
    }

    /// @notice Claim withdrawals batch once finalized (claimable)
    /// @param _requestIds ids of the finalized requests to claim
    /// @param _hints rate indices found offchain that should be used for claiming
    function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints) external {
        if (_requestIds.length != _hints.length) revert LengthsMismatch(_requestIds.length, _hints.length);
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            claimWithdrawal(_requestIds[i], _hints[i]);
        }
    }

    /// @notice Returns the list of hints for the given request ids
    /// @param _requestIds ids of the requests to get hints for
    function findClaimHints(uint256[] calldata _requestIds) external view returns (uint256[] memory hintIds) {
        hintIds = new uint256[](_requestIds.length);
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            hintIds[i] = findClaimHint(_requestIds[i]);
        }
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

    /// @dev internal initialization helper. Doesn't check provided addresses intentionally
    function _initialize(address _admin, address _pauser, address _resumer, address _finalizer) internal {
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) {
            revert AlreadyInitialized();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAUSE_ROLE, _pauser);
        _grantRole(RESUME_ROLE, _resumer);
        _grantRole(FINALIZE_ROLE, _finalizer);

        CONTRACT_VERSION_POSITION.setStorageUint256(1);

        RESUMED_POSITION.setStorageBool(false); // pause it explicitly

        emit InitializedV1(_admin, _pauser, _resumer, _finalizer, msg.sender);
    }

    function _enqueueWithdrawalRequest(address _tokensHolder, WithdrawalRequestInput memory _withdrawalRequestInput)
        internal
        onlyValidWithdrawalRequestInput(_withdrawalRequestInput)
        returns (uint256 requestId)
    {
        (uint256 collectedAmountOfStETH, uint256 collectedAmountOfShares) = _collectWithdrawableToken(
            _tokensHolder,
            _withdrawalRequestInput
        );
        address recipient = _withdrawalRequestInput.recipient;
        requestId = _enqueue(
            collectedAmountOfStETH,
            collectedAmountOfShares,
            recipient == address(0) ? msg.sender : recipient
        );
    }

    function _collectWithdrawableToken(address _tokenHolder, WithdrawalRequestInput memory _withdrawalRequestInput)
        internal
        returns (uint256 collectedAmountOfStETH, uint256 collectedAmountOfShares)
    {
        uint256 amount = _withdrawalRequestInput.amount;
        SafeERC20.safeTransferFrom(IERC20(_withdrawalRequestInput.token), _tokenHolder, address(this), amount);
        collectedAmountOfStETH = _withdrawalRequestInput.token == address(WSTETH) ? WSTETH.unwrap(amount) : amount;
        collectedAmountOfShares = STETH.getSharesByPooledEth(collectedAmountOfStETH);
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

    modifier onlyValidWithdrawalRequestInput(WithdrawalRequestInput memory _withdrawalRequestInput) {
        address token = _withdrawalRequestInput.token;
        if (token != address(STETH) && token != address(WSTETH)) {
            address[] memory withdrawableTokens = new address[](2);
            withdrawableTokens[0] = address(STETH);
            withdrawableTokens[1] = address(WSTETH);
            revert UnsupportedWithdrawalToken(token, withdrawableTokens);
        }

        uint256 amountOfStETH = _withdrawalRequestInput.token == address(WSTETH)
            ? WSTETH.getStETHByWstETH(_withdrawalRequestInput.amount)
            : _withdrawalRequestInput.amount;

        if (amountOfStETH < MIN_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooSmall(amountOfStETH);
        }
        if (amountOfStETH > MAX_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooLarge(amountOfStETH);
        }
        _;
    }
}
