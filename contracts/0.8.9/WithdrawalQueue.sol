// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";

import {AccessControlEnumerable} from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

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
        /// @notice sum of the all requested ether including this request
        uint128 cumulativeEther;
        /// @notice sum of the all shares locked for withdrawal including this request
        uint128 cumulativeShares;
        /// @notice payable address of the recipient withdrawal will be transferred to
        address payable recipient;
        /// @notice block.number when the request created
        uint64 requestBlockNumber;
        /// @notice flag if the request was already claimed
        bool claimed;
    }

    /**
     * @notice structure representing share rate for a range (`prevIndex`, `index`] in request queue
     */
    struct ShareRate {
        /// @notice share/ETH rate with 1e27 precision for the protocol
        uint256 value;
        /// @notice last index in queue this rate is actual for
        /// @dev the rate is valid for (`prevIndex`, `index`] where `prevIndex` is previous element `index` value or 0
        uint256 index;
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

    /// Lido stETH token address to be set upon construction
    address public immutable STETH;
    /// Lido wstETH token address to be set upon construction
    address public immutable WSTETH;

    // ACL

    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant FINALIZE_ROLE = keccak256("FINALIZE_ROLE");

    /**
     * @notice minimal possible sum that is possible to withdraw
     */
    uint256 public constant MIN_STETH_WITHDRAWAL_AMOUNT = 100 wei;

    /**
     * @notice maximum possible sum that is possible to withdraw by a single request
     * Prevents accumulating too much funds per single request fulfillment in the future.
     * @dev To withdraw larger amounts, recommended to split it to several requests
     */
    uint256 public constant MAX_STETH_WITHDRAWAL_AMOUNT = 1000 ether;

    uint256 public constant SHARE_RATE_PRECISION = 1e27;

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///  Inherited from AccessControlEnumerable:
    ///! SLOT 0: mapping(bytes32 => RoleData) _roles
    ///! SLOT 1: mapping(bytes32 => EnumerableSet.AddressSet) _roleMembers
    ///  Own:
    ///! SLOT 2: uint128 lockedEtherAmount
    ///! SLOT 3: uint256 finalizedRequestsCounter
    ///! SLOT 4: WithdrawalRequest[] queue
    ///! SLOT 5: mapping(address => uint256[]) requestsByRecipient
    ///! SLOT 6: ShareRate[] finalizationRates

    /**
     * @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
     * @dev Invariant: `lockedEtherAmount <= this.balance`
     */
    uint128 public lockedEtherAmount = 0;

    /// @notice length of the finalized part of the queue
    uint256 public finalizedRequestsCounter = 0;

    /// @notice queue for withdrawal requests
    WithdrawalRequest[] internal queue;

    /// @notice withdrawal requests mapped to the recipients
    mapping(address => uint256[]) public requestsByRecipient;

    /// @notice finalization rates history
    ShareRate[] public finalizationRates;

    /**
     * @param _stETH address of StETH contract
     * @param _wstETH address of WstETH contract
     */
    constructor(address _stETH, address _wstETH) {
        // init immutables
        STETH = _stETH;
        WSTETH = _wstETH;

        // petrify the implementation by assigning a zero addresses for every role
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

    /**
     * @notice Request withdrawal of the provided stETH token amount
     * @param _amountOfStETH StETH tokens that will be locked for withdrawal
     * @param _recipient address to send ether to upon withdrawal. Will be set to `msg.sender` if `address(0)` is passed
     * @dev Reverts with `ResumedExpected()` if contract is paused
     * @dev Reverts with `RequestAmountTooSmall(_amountOfStETH)` if amount is less than `MIN_STETH_WITHDRAWAL_AMOUNT`
     * @dev Reverts with `RequestAmountTooLarge(_amountOfStETH)` if amount is greater than `MAX_STETH_WITHDRAWAL_AMOUNT`
     * @dev Reverts if failed to transfer StETH to the contract
     */
    function requestWithdrawal(
        uint256 _amountOfStETH,
        address _recipient
    ) external whenResumed returns (uint256 requestId) {
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
    function requestWithdrawalWstETH(
        uint256 _amountOfWstETH,
        address _recipient
    ) external whenResumed returns (uint256 requestId) {
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
    function requestWithdrawalBatch(
        uint256[] calldata,
        address[] calldata
    ) external view whenResumed returns (uint256[] memory) {
        revert Unimplemented();
    }

    /// @notice Claim withdrawals batch once finalized (claimable)
    /// NB: Always reverts
    function claimWithdrawalBatch(uint256[] calldata /*_requests*/) external pure {
        revert Unimplemented();
    }

    /// @notice Returns all withdrawal requests placed for the `_recipient` address
    function getWithdrawalRequests(address _recipient) external view returns (uint256[] memory requestsIds) {
        return requestsByRecipient[_recipient];
    }

    /**
     * @notice Returns status of the withdrawal request
     * @param _requestId id of the request
     * @return recipient address to send ETH to once request is finalized and claimed
     * @
     */
    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            address recipient,
            uint256 requestBlockNumber,
            uint256 etherToWithdraw,
            uint256 shares,
            bool isFinalized,
            bool isClaimed
        )
    {
        if (_requestId < queue.length) {
            WithdrawalRequest memory request = queue[_requestId];

            recipient = request.recipient;
            requestBlockNumber = request.requestBlockNumber;

            shares = request.cumulativeShares;
            etherToWithdraw = request.cumulativeEther;
            if (_requestId > 0) {
                shares -= queue[_requestId - 1].cumulativeShares;
                etherToWithdraw -= queue[_requestId - 1].cumulativeEther;
            }

            isFinalized = _requestId < finalizedRequestsCounter;
            isClaimed = request.claimed;
        }
    }

    /**
     * @notice Finalize requests in [`finalizedRequestsCounter`,`_lastRequestIdToFinalize`] range with `_shareRate`
     * @dev ether to finalize all the requests should be calculated using `calculateFinalizationParams` and sent with
     * this call as msg.value
     * @param _lastRequestIdToFinalize request index in the queue that will be last finalized request in a batch
     * @param _shareRate share/ETH rate for the protocol with 1e27 decimals
     */
    function finalize(
        uint256 _lastRequestIdToFinalize, 
        uint256 _shareRate
    ) external payable whenResumed onlyRole(FINALIZE_ROLE) {
        if (_lastRequestIdToFinalize < finalizedRequestsCounter || _lastRequestIdToFinalize >= queue.length) {
            revert InvalidFinalizationId();
        }
        (uint128 ethToWithdraw, ) = _calculateDiscountedBatch(
            finalizedRequestsCounter,
            _lastRequestIdToFinalize,
            _shareRate
        );

        if (msg.value < ethToWithdraw) revert NotEnoughEther();

        _updateRateHistory(_shareRate, _lastRequestIdToFinalize);

        lockedEtherAmount += _toUint128(msg.value);

        finalizedRequestsCounter = _lastRequestIdToFinalize + 1;
    }

    /**
     * @notice calculates the params to fulfill the next batch of requests in queue
     * @param _lastIdToFinalize last id in the queue to finalize upon
     * @param _shareRate share rate to finalize requests with
     *
     * @return etherToLock amount of eth required to finalize the batch
     * @return sharesToBurn amount of shares that should be burned on finalization
     */
    function calculateFinalizationParams(
        uint256 _lastIdToFinalize,
        uint256 _shareRate
    ) external view returns (uint128 etherToLock, uint128 sharesToBurn) {
        return _calculateDiscountedBatch(finalizedRequestsCounter, _lastIdToFinalize, _shareRate);
    }

    /**
     * @notice Transfer the right to claim withdrawal to another `_newRecipient`
     * @dev should be called by the old recepient
     * @param _requestId id of the request subject to change
     * @param _newRecipient new recipient address for withdrawal
     */
    function changeRecipient(uint256 _requestId, address _newRecipient) external {
        WithdrawalRequest storage request = queue[_requestId];

        if (request.recipient != msg.sender) revert RecipientExpected(request.recipient, msg.sender);
        if (request.claimed) revert RequestAlreadyClaimed();

        request.recipient = payable(_newRecipient);
    }

    /**
     * @notice Claim `_requestId` request and transfer reserved ether to recipient
     * @param _requestId request id to claim
     * @param _rateIndexHint rate index found offchain that should be used for claiming
     */
    function claimWithdrawal(uint256 _requestId, uint256 _rateIndexHint) external {
        // request must be finalized
        if (_requestId >= finalizedRequestsCounter) revert RequestNotFinalized();

        WithdrawalRequest storage request = queue[_requestId];

        if (request.claimed) revert RequestAlreadyClaimed();
        request.claimed = true;

        ShareRate memory shareRate;

        if (_isRateHintValid(_requestId, _rateIndexHint)) {
            shareRate = finalizationRates[_rateIndexHint];
        } else {
            // unbounded loop branch. Can fail with OOG
            shareRate = finalizationRates[findClaimRateHint(_requestId)];
        }

        (uint128 etherToBeClaimed, ) = _calculateDiscountedBatch(_requestId, _requestId, shareRate.value);

        lockedEtherAmount -= etherToBeClaimed;

        _sendValue(request.recipient, etherToBeClaimed);

        emit WithdrawalClaimed(_requestId, request.recipient, msg.sender);
    }

    /**
     * @notice view function to find a proper ShareRate offchain to pass it to `claim()` later
     * @param _requestId request id to be claimed later
     *
     * @return hint rate index for this request
     */
    function findClaimRateHint(uint256 _requestId) public view returns (uint256 hint) {
        if (_requestId >= finalizedRequestsCounter) revert RateNotFound();

        for (uint256 i = finalizationRates.length; i > 0; i--) {
            if (_isRateHintValid(_requestId, i - 1)) {
                return i - 1;
            }
        }
        assert(false);
    }

    /// @dev calculates `eth` and `shares` for the batch of requests in (`_firstId`, `_lastId`] range using `_shareRate`
    function _calculateDiscountedBatch(
        uint256 _firstId,
        uint256 _lastId,
        uint256 _shareRate
    ) internal view returns (uint128 eth, uint128 shares) {
        eth = queue[_lastId].cumulativeEther;
        shares = queue[_lastId].cumulativeShares;

        if (_firstId > 0) {
            eth -= queue[_firstId - 1].cumulativeEther;
            shares -= queue[_firstId - 1].cumulativeShares;
        }

        eth = _min(eth, _toUint128(shares * _shareRate / SHARE_RATE_PRECISION));
    }

    /// @dev checks if provided request included in the rate hint boundaries
    function _isRateHintValid(uint256 _requestId, uint256 _hint) internal view returns (bool isInRange) {
        uint256 rightBoundary = finalizationRates[_hint].index;

        isInRange = _requestId <= rightBoundary;
        if (_hint > 0) {
            uint256 leftBoundary = finalizationRates[_hint - 1].index;

            isInRange = isInRange && leftBoundary < _requestId;
        }
    }

    /// @dev add a new entry to share rates history or modify the last one if rate does not change
    function _updateRateHistory(uint256 _shareRate, uint256 _index) internal {
        if (finalizationRates.length == 0) {
            finalizationRates.push(ShareRate(_shareRate, _index));
        } else {
            ShareRate storage lastRate = finalizationRates[finalizationRates.length - 1];

            if (_shareRate == lastRate.value) {
                lastRate.index = _index;
            } else {
                finalizationRates.push(ShareRate(_shareRate, _index));
            }
        }
    }

    /// @notice internal initialization helper
    /// @dev doesn't check provided addresses intentionally
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

    function _requestWithdrawalWstETH(
        uint256 _amountOfWstETH,
        address _recipient
    ) internal returns (uint256 requestId) {
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
        uint256 cumulativeEther = _amountOfStETH;

        if (requestId > 0) {
            WithdrawalRequest memory prevRequest = queue[requestId - 1];

            cumulativeShares += prevRequest.cumulativeShares;
            cumulativeEther += prevRequest.cumulativeEther;
        }

        queue.push(
            WithdrawalRequest(
                uint128(cumulativeEther),
                uint128(cumulativeShares),
                payable(_recipient),
                uint64(block.number),
                false
            )
        );

        requestsByRecipient[msg.sender].push(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _recipient, _amountOfStETH, shares);
    }

    function _min(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }

    function _sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) revert SafeCastValueDoesNotFit96Bits();
        return uint64(value);
    }

    function _toUint128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) revert SafeCastValueDoesNotFit128Bits();
        return uint128(value);
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
    error RecipientExpected(address _recipient, address _msgSender);
    error AlreadyInitialized();
    error Uninitialized();
    error Unimplemented();
    error PausedExpected();
    error ResumedExpected();
    error RequestAmountTooSmall(uint256 _amountOfStETH);
    error RequestAmountTooLarge(uint256 _amountOfStETH);
    error InvalidFinalizationId();
    error NotEnoughEther();
    error RequestNotFinalized();
    error RequestAlreadyClaimed();
    error RateNotFound();
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit96Bits();
    error SafeCastValueDoesNotFit128Bits();
}
