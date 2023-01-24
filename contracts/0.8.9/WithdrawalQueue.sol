// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";

import {AccessControlEnumerable} from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

import "./lib/UnstructuredStorage.sol";

/**
 * @title Interface defining a Lido liquid staking pool
 * @dev see also [Lido liquid staking pool core contract](https://docs.lido.fi/contracts/lido)
 */
interface IStETH {
    /**
     * @notice Get stETH token amount by the provided shares amount
     * @param _sharesAmount shares amount
     * @dev dual to `getSharesByPooledEth`.
     */
    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);

    /**
     * @notice Get shares amount by the stETH token amount
     * @param _pooledEthAmount stETH token amount
     * @dev dual to `getPooledEthByShares`.
     */
    function getSharesByPooledEth(uint256 _pooledEthAmount) external view returns (uint256);
}

interface IWstETH {
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
}

/**
 * @title A dedicated contract for handling stETH withdrawal request queue
 * @author folkyatina
 */
contract WithdrawalQueue is AccessControlEnumerable {
    using SafeERC20 for IERC20;
    using UnstructuredStorage for bytes32;

    /// @notice structure representing a request for withdrawal.
    struct WithdrawalRequest {
        /// @notice sum of the all stETH submitted for withdrawals up to this request
        uint128 cumulativeStETH;
        /// @notice sum of the all shares locked for withdrawal up to this request
        uint128 cumulativeShares;
        /// @notice payable address of the recipient eth will be transferred to
        address payable recipient;
        /// @notice block.number when the request was created
        uint64 blockNumber;
        /// @notice flag if the request was claimed
        bool claimed;
    }

    /// @notice structure representing a discount that is applied to request batch on finalization
    struct Discount {
        /// @notice discount factor with 1e27 precision (0 - 100% discount, 1e27 - means no discount)
        uint256 discountFactor;
        /**
         * @notice last index in queue the discount is applicable to
         * @dev the `discountingFactor` is valid for (`previuosIndex`, `index`]
         */
        uint256 indexInQueue;
    }

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.WithdrawalQueue.contractVersion");
    /// Withdrawal queue resume/pause control storage slot
    bytes32 internal constant RESUMED_POSITION = keccak256("lido.WithdrawalQueue.resumed");

    /// @notice Lido stETH token address to be set upon construction
    address public immutable STETH;
    /// @notice Lido wstETH token address to be set upon construction
    address public immutable WSTETH;

    // ACL
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant FINALIZE_ROLE = keccak256("FINALIZE_ROLE");

    /// @notice minimal possible sum that is possible to withdraw
    uint256 public constant MIN_STETH_WITHDRAWAL_AMOUNT = 100;

    /**
     * @notice maximum possible sum that is possible to withdraw by a single request
     * Prevents accumulating too much funds per single request fulfillment in the future.
     * @dev To withdraw larger amounts, recommended to split it to several requests
     */
    uint256 public constant MAX_STETH_WITHDRAWAL_AMOUNT = 1000 * 1e18;

    /// @notice precision base for share rate and discounting factor values in the contract
    uint256 public constant E27_PRECISION_BASE = 1e27;

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///  Inherited from AccessControlEnumerable:
    ///! SLOT 0: mapping(bytes32 => RoleData) _roles
    ///! SLOT 1: mapping(bytes32 => EnumerableSet.AddressSet) _roleMembers
    ///  Own:
    ///! SLOT 2: uint128 lockedEtherAmount
    ///! SLOT 3: uint256 finalizedRequestsCounter
    ///! SLOT 4: WithdrawalRequest[] queue
    ///! SLOT 5: mapping(address => uint256[]) requestsByRecipient
    ///! SLOT 6: Discount[] discountHistory

    /// @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
    uint128 public lockedEtherAmount = 0;

    /// @notice length of the finalized part of the queue
    uint256 public finalizedRequestsCounter = 0;

    /// @notice queue for withdrawal requests
    WithdrawalRequest[] internal queue;

    /// @notice withdrawal requests mapped to the recipients
    mapping(address => uint256[]) public requestsByRecipient;

    /// @notice finalization discount history
    Discount[] public discountHistory;

    /**
     * @param _stETH address of StETH contract
     * @param _wstETH address of WstETH contract
     */
    constructor(address _stETH, address _wstETH) {
        // init immutables
        STETH = _stETH;
        WSTETH = _wstETH;

        // petrify the implementation by assigning a zero address for every role
        _initialize(address(0), address(0), address(0), address(0));
    }

    /**
     * @notice Intialize the contract storage explicitly. NB! It's initialized in paused state by default
     * @param _admin admin address that can change every role.
     * @param _pauser address that will be able to pause the withdrawals
     * @param _resumer address that will be able to resume the withdrawals after pause
     * @param _finalizer address that can finalize requests in the queue
     * @dev Reverts with `AdminZeroAddress()` if `_admin` equals to `address(0)`
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

    /// @notice Returns the length of the withdrawal request queue
    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    /// @notice return number of unfinalized requests in the queue
    function unfinalizedQueueLength() external view returns (uint256) {
        return queue.length - finalizedRequestsCounter;
    }

    /// @notice amount of stETH yet to be finalized
    function unfinalizedStETH() external view returns (uint256 stETHAmountToFinalize) {
        stETHAmountToFinalize = 0;
        if (queue.length > 0) {
            stETHAmountToFinalize = queue[queue.length - 1].cumulativeStETH;
            if (finalizedRequestsCounter > 0) {
                stETHAmountToFinalize -= queue[finalizedRequestsCounter - 1].cumulativeStETH;
            }
        }
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

        IERC20Permit(STETH).permit(msg.sender, address(this), _amountOfStETH, _deadline, _v, _r, _s);

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
        IERC20Permit(WSTETH).permit(msg.sender, address(this), _amountOfWstETH, _deadline, _v, _r, _s);
        return _requestWithdrawalWstETH(_amountOfWstETH, _recipient);
    }

    /// @notice Request withdrawal of the provided token amount in a batch
    /// NB: Always reverts
    function requestWithdrawalBatch(uint256[] calldata, address[] calldata)
        external
        view
        whenResumed
        returns (uint256[] memory)
    {
        revert Unimplemented();
    }

    /// @notice Claim withdrawals batch once finalized (claimable)
    /// NB: Always reverts
    function claimWithdrawalBatch(uint256[] calldata /*_requests*/ ) external pure {
        revert Unimplemented();
    }

    /// @notice Returns all withdrawal requests placed for the `_recipient` address
    function getWithdrawalRequests(address _recipient) external view returns (uint256[] memory requestsIds) {
        return requestsByRecipient[_recipient];
    }

    /**
     * @notice Returns status of the withdrawal request
     * @param _requestId id of the request
     */
    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            uint256 amountOfStETH,
            uint256 amountOfShares,
            address recipient,
            uint256 blockNumber,
            bool isFinalized,
            bool isClaimed
        )
    {
        if (_requestId < queue.length) {
            WithdrawalRequest memory request = queue[_requestId];

            recipient = request.recipient;
            blockNumber = request.blockNumber;

            amountOfShares = request.cumulativeShares;
            amountOfStETH = request.cumulativeStETH;
            if (_requestId > 0) {
                amountOfShares -= queue[_requestId - 1].cumulativeShares;
                amountOfStETH -= queue[_requestId - 1].cumulativeStETH;
            }

            isFinalized = _requestId < finalizedRequestsCounter;
            isClaimed = request.claimed;
        }
    }

    /**
     * @notice returns the amount of ETH to be send along to finalize this batch and the amount of shares to burn after
     * @param _lastRequestIdToFinalize the index in the request queue that should be used as the end of the batch
     * @param _shareRate share rate that will be used to calculate the batch value
     *
     * @return eth amount of ETH required to finalize the batch
     * @return shares amount of shares that should be burned on finalization
     */
    function finalizationBatch(uint256 _lastRequestIdToFinalize, uint256 _shareRate)
        external
        view
        returns (uint128 eth, uint128 shares)
    {
        (eth, shares) = _batch(finalizedRequestsCounter, _lastRequestIdToFinalize);
        uint256 batchValue = shares * _shareRate / E27_PRECISION_BASE;
        uint256 discountFactor = _calculateDiscountFactor(eth, batchValue);
        eth = _applyDiscount(eth, discountFactor);
    }

    /**
     * @notice Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
     * @dev ether to finalize all the requests should be calculated using `finalizationBatch()` and sent along
     *
     * @param _lastRequestIdToFinalize request index in the queue that will be last finalized request in a batch
     */
    function finalize(uint256 _lastRequestIdToFinalize) external payable whenResumed onlyRole(FINALIZE_ROLE) {
        if (_lastRequestIdToFinalize < finalizedRequestsCounter || _lastRequestIdToFinalize >= queue.length) {
            revert InvalidFinalizationId();
        }

        (uint128 amountOfStETH,) = _batch(finalizedRequestsCounter, _lastRequestIdToFinalize);
        uint256 discountFactor = _calculateDiscountFactor(amountOfStETH, msg.value);

        _updateDiscountHistory(discountFactor, _lastRequestIdToFinalize);

        lockedEtherAmount += _applyDiscount(amountOfStETH, discountFactor);
        finalizedRequestsCounter = _lastRequestIdToFinalize + 1;
    }

    /**
     * @notice Transfer the right to claim withdrawal to another `_newRecipient`
     * @dev should be called by the old recepient
     * @param _requestId id of the request subject to change
     * @param _newRecipient new recipient address for withdrawal
     */
    function changeRecipient(uint256 _requestId, address _newRecipient) external {
        if (_newRecipient == address(0)) revert RecipientZeroAddress();

        WithdrawalRequest storage request = queue[_requestId];

        if (msg.sender != request.recipient) revert SenderExpected(request.recipient, msg.sender);
        if (request.claimed) revert RequestAlreadyClaimed();

        request.recipient = payable(_newRecipient);
    }

    /**
     * @notice Claim `_requestId` request and transfer reserved ether to recipient
     * @param _requestId request id to claim
     * @param _hint rate index found offchain that should be used for claiming
     */
    function claimWithdrawal(uint256 _requestId, uint256 _hint) external {
        if (_requestId >= finalizedRequestsCounter) revert RequestNotFinalized();

        WithdrawalRequest storage request = queue[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed();

        request.claimed = true;

        Discount memory discount;
        if (_isHintValid(_requestId, _hint)) {
            discount = discountHistory[_hint];
        } else {
            revert InvalidHint();
        }

        (uint128 ethToSend,) = _batch(_requestId, _requestId);
        ethToSend = _applyDiscount(ethToSend, discount.discountFactor);

        lockedEtherAmount -= ethToSend;

        _sendValue(request.recipient, ethToSend);

        emit WithdrawalClaimed(_requestId, request.recipient, msg.sender);
    }

    /**
     * @notice view function to find a proper Discount offchain to pass it to `claim()` later
     * @param _requestId request id to be claimed later
     *
     * @return hint discount index for this request
     */
    function findClaimDiscountHint(uint256 _requestId) public view returns (uint256 hint) {
        // binary search
        if (_requestId >= finalizedRequestsCounter) revert InvalidHint();

        for (uint256 i = discountHistory.length; i > 0; i--) {
            if (_isHintValid(_requestId, i - 1)) {
                return i - 1;
            }
        }
        assert(false);
    }

    /// @dev calculates the sum of stETH and shares for all requests in [`_firstId`, `_lastId`]
    function _batch(uint256 _firstId, uint256 _lastId)
        internal
        view
        returns (uint128 amountOfStETH, uint128 amountOfShares)
    {
        amountOfStETH = queue[_lastId].cumulativeStETH;
        amountOfShares = queue[_lastId].cumulativeShares;

        if (_firstId > 0) {
            amountOfStETH -= queue[_firstId - 1].cumulativeStETH;
            amountOfShares -= queue[_firstId - 1].cumulativeShares;
        }
    }

    /// @dev returns discount factor for finalization
    function _calculateDiscountFactor(uint256 _requestedValue, uint256 _realValue) internal pure returns (uint256) {
        if (_requestedValue > _realValue) {
            return _realValue * E27_PRECISION_BASE / _requestedValue;
        }
        return E27_PRECISION_BASE;
    }

    /// @dev apply discount factor to the given amount of tokens
    function _applyDiscount(uint128 _amountOfStETH, uint256 _discountFactor) internal pure returns (uint128) {
        return _toUint128(_amountOfStETH * _discountFactor / E27_PRECISION_BASE);
    }

    /// @dev checks if provided request included in the discount hint boundaries
    function _isHintValid(uint256 _requestId, uint256 _indexHint) internal view returns (bool isInRange) {
        uint256 rightBoundary = discountHistory[_indexHint].indexInQueue;

        isInRange = _requestId <= rightBoundary;
        if (_indexHint > 0) {
            uint256 leftBoundary = discountHistory[_indexHint - 1].indexInQueue;

            isInRange = isInRange && leftBoundary < _requestId;
        }
    }

    /// @dev add a new entry to discount history or modify the last one if discount does not change
    function _updateDiscountHistory(uint256 _discountFactor, uint256 _index) internal {
        if (discountHistory.length == 0) {
            discountHistory.push(Discount(_discountFactor, _index));
        } else {
            Discount storage previousDiscount = discountHistory[discountHistory.length - 1];

            if (_discountFactor == previousDiscount.discountFactor) {
                previousDiscount.indexInQueue = _index;
            } else {
                discountHistory.push(Discount(_discountFactor, _index));
            }
        }
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

    function _requestWithdrawal(uint256 _amountOfStETH, address _recipient) internal returns (uint256 requestId) {
        IERC20(STETH).safeTransferFrom(msg.sender, address(this), _amountOfStETH);

        return _enqueue(_amountOfStETH, _recipient);
    }

    function _requestWithdrawalWstETH(uint256 _amountOfWstETH, address _recipient)
        internal
        returns (uint256 requestId)
    {
        IERC20(WSTETH).safeTransferFrom(msg.sender, address(this), _amountOfWstETH);
        uint256 amountOfStETH = IWstETH(WSTETH).unwrap(_amountOfWstETH);

        return _enqueue(amountOfStETH, _recipient);
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

    function _enqueue(uint256 _amountOfStETH, address _recipient) internal returns (uint256 requestId) {
        requestId = queue.length;

        uint256 shares = IStETH(STETH).getSharesByPooledEth(_amountOfStETH);

        uint256 cumulativeShares = shares;
        uint256 cumulativeStETH = _amountOfStETH;

        if (requestId > 0) {
            WithdrawalRequest memory prevRequest = queue[requestId - 1];

            cumulativeShares += prevRequest.cumulativeShares;
            cumulativeStETH += prevRequest.cumulativeStETH;
        }

        queue.push(
            WithdrawalRequest(
                _toUint128(cumulativeStETH),
                _toUint128(cumulativeShares),
                payable(_recipient),
                _toUint64(block.number),
                false
            )
        );

        requestsByRecipient[msg.sender].push(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _recipient, _amountOfStETH, shares);
    }

    function _min(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }

    function _sendValue(address payable _recipient, uint256 _amount) internal {
        if (address(this).balance < _amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success,) = _recipient.call{value: _amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }

    function _toUint64(uint256 _value) internal pure returns (uint64) {
        if (_value > type(uint64).max) revert SafeCastValueDoesNotFit96Bits();
        return uint64(_value);
    }

    function _toUint128(uint256 _value) internal pure returns (uint128) {
        if (_value > type(uint128).max) revert SafeCastValueDoesNotFit128Bits();
        return uint128(_value);
    }

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

    /// @notice Emitted when a new withdrawal request enqueued
    /// @dev Contains both stETH token amount and its corresponding shares amount
    event WithdrawalRequested(
        uint256 indexed requestId,
        address indexed requestor,
        address indexed recipient,
        uint256 amountOfStETH,
        uint256 amountOfShares
    );
    /// @notice Emitted when withdrawal requests placement paused
    event WithdrawalQueuePaused();
    /// @notice Emitted when withdrawal requests placement resumed
    event WithdrawalQueueResumed();
    /// @notice Emitted when the contract initialized
    /// @param _admin provided admin address
    /// @param _caller initialization `msg.sender`
    event InitializedV1(address _admin, address _pauser, address _resumer, address _finalizer, address _caller);
    event WithdrawalClaimed(uint256 indexed requestId, address indexed receiver, address initiator);

    error AdminZeroAddress();
    error RecipientZeroAddress();
    error SenderExpected(address _recipient, address _msgSender);
    error AlreadyInitialized();
    error Uninitialized();
    error Unimplemented();
    error PausedExpected();
    error ResumedExpected();
    error RequestAmountTooSmall(uint256 _amountOfStETH);
    error RequestAmountTooLarge(uint256 _amountOfStETH);
    error InvalidFinalizationId();
    error NotEnoughEther();
    error InvalidMsgValue(uint256 _actualAmount, uint256 _expectedAmount);
    error RequestNotFinalized();
    error RequestAlreadyClaimed();
    error InvalidHint();
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit96Bits();
    error SafeCastValueDoesNotFit128Bits();
}
