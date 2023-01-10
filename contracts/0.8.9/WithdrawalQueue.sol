// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";

import "./lib/AragonUnstructuredStorage.sol";

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
contract WithdrawalQueue {
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

    /// Lido DAO Agent contract address
    /// Used to call administrative levers
    bytes32 internal constant LIDO_DAO_AGENT_POSITION = keccak256("lido.WithdrawalQueue.lidoDAOAgent");

    /// Requests placement resume/pause control storage slot
    bytes32 internal constant REQUESTS_PLACEMENT_RESUMED_POSITION =
        keccak256("lido.WithdrawalQueue.requestsPlacementResumed");

    /// Lido stETH token address to be set upon construction
    address public immutable STETH;
    /// Lido wstETH token address to be set upon construction
    address public immutable WSTETH;

    /**
     * @notice All state-modifying calls are allowed only from owner protocol.
     * @dev should be Lido
     */
    address payable public immutable OWNER;

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

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///! SLOT 0: uint128 lockedEtherAmount
    ///! SLOT 1: uint256 finalizedRequestsCounter
    ///! SLOT 2: WithdrawalRequest[] queue
    ///! SLOT 3: mapping(address => uint256[]) requestsByRecipient
    ///! SLOT 4 ShareRate[] finalizationRates

    /**
     * @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
     * @dev Invariant: `lockedEtherAmount <= this.balance`
     */
    uint128 public lockedEtherAmount = 0;

    /// @notice length of the finalized part of the queue
    uint256 public finalizedRequestsCounter = 0;

    /// @notice queue for withdrawal requests
    WithdrawalRequest[] public queue;

    /// @notice withdrawal requests mapped to the recipients
    mapping(address => uint256[]) public requestsByRecipient;

    /// @notice finalization rates history
    ShareRate[] public finalizationRates;

    /**
     * @param _owner address that will be able to invoke `restake` and `finalize` methods.
     * @param _stETH address of StETH contract
     * @param _wstETH address of WstETH contract
     */
    constructor(address payable _owner, address _stETH, address _wstETH) {
        if (_owner == address(0)) revert ZeroOwner();

        // init immutables
        STETH = _stETH;
        WSTETH = _wstETH;
        OWNER = _owner;

        // petrify the implementation by assigning a zero Lido agent address
        _initialize(address(0));
    }

    function initialize(address _lidoDAOAgent) external {
        if (_lidoDAOAgent == address(0)) {
            revert LidoDAOAgentZeroAddress();
        }

        _initialize(_lidoDAOAgent);
    }

    /// @notice Resume new withdrawal requests placement
    function resumeRequestsPlacement() external whenInitialized whenPaused onlyLidoDAOAgent {
        REQUESTS_PLACEMENT_RESUMED_POSITION.setStorageBool(true);

        emit WithdrawalRequestsPlacementResumed();
    }

    /// @notice Pause new withdrawal requests placement
    function pauseRequestsPlacement() external whenResumed onlyLidoDAOAgent {
        REQUESTS_PLACEMENT_RESUMED_POSITION.setStorageBool(false);

        emit WithdrawalRequestsPlacementPaused();
    }

    /**
     * @notice Getter for withdrawal queue length
     * @return length of the request queue
     */
    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    /// @notice Request withdrawal of the provided stETH token amount
    function requestWithdrawal(
        uint256 _amountOfStETH,
        address _recipient
    ) external whenResumed returns (uint256 requestId) {
        _recipient = _checkWithdrawalRequestInput(_amountOfStETH, _recipient);
        return _requestWithdrawal(_amountOfStETH, _recipient);
    }

    /**
     * @notice Request withdrawal of the provided stETH token amount using EIP-2612 Permit
     * @dev NB: requires permit in stETH being implemented
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

    /// @notice Request withdrawal of the provided wstETH token amount
    function requestWithdrawalWstETH(
        uint256 _amountOfWstETH,
        address _recipient
    ) external whenResumed returns (uint256 requestId) {
        _recipient = _checkWithdrawalRequestInput(IWstETH(WSTETH).getStETHByWstETH(_amountOfWstETH), _recipient);
        return _requestWithdrawalWstETH(_amountOfWstETH, _recipient);
    }

    /// @notice Request withdrawal of the provided wstETH token amount using EIP-2612 Permit
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

    /// @notice Claim withdrawals batch once finalized (claimable)
    /// NB: Always reverts
    function claimWithdrawalsBatch(uint256[] calldata /*_requests*/) external pure {
        revert Unimplemented();
    }

    /// @notice Returns withdrawal requests placed for the `_recipient` address
    function getWithdrawalRequests(address _recipient) external view returns (uint256[] memory requestsIds) {
        return requestsByRecipient[_recipient];
    }

    /// @notice Returns status of the withdrawal request
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

    /// @notice Returns Lido DAO Agent address
    function getLidoDAOAgent() external view returns (address) {
        return LIDO_DAO_AGENT_POSITION.getStorageAddress();
    }

    /// @notice Returns whether the contract is initialized or not
    function isInitialized() external view returns (bool) {
        return CONTRACT_VERSION_POSITION.getStorageUint256() != 0;
    }

    /// @notice Returns whether the requests placement is paused or not
    function isRequestsPlacementPaused() external view returns (bool) {
        return !REQUESTS_PLACEMENT_RESUMED_POSITION.getStorageBool();
    }

    /**
     * @notice Finalize requests in [`finalizedRequestsCounter`,`_lastIdToFinalize`] range with `_shareRate`
     * @dev ether to finalize all the requests should be calculated using `calculateFinalizationParams` and sent with
     * this call as msg.value
     * @param _lastIdToFinalize request index in the queue that will be last finalized request in a batch
     * @param _shareRate share/ETH rate for the protocol with 1e27 decimals
     */
    function finalize(uint256 _lastIdToFinalize, uint256 _shareRate) external payable onlyOwner {
        if (_lastIdToFinalize < finalizedRequestsCounter || _lastIdToFinalize >= queue.length) {
            revert InvalidFinalizationId();
        }
        if (lockedEtherAmount + msg.value > address(this).balance) revert NotEnoughEther();

        _updateRateHistory(_shareRate, _lastIdToFinalize);

        lockedEtherAmount += _toUint128(msg.value);

        finalizedRequestsCounter = _lastIdToFinalize + 1;
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
    ) external view returns (uint256 etherToLock, uint256 sharesToBurn) {
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
            shareRate = finalizationRates[findRateHint(_requestId)];
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
    function findRateHint(uint256 _requestId) public view returns (uint256 hint) {
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

        eth = _min(eth, _toUint128((shares * _shareRate) / 1e9));
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
    /// @dev doesn't check provided address intentionally
    function _initialize(address _lidoDAOAgent) internal {
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) {
            revert AlreadyInitialized();
        }

        LIDO_DAO_AGENT_POSITION.setStorageAddress(_lidoDAOAgent);
        CONTRACT_VERSION_POSITION.setStorageUint256(1);

        emit InitializedV1(_lidoDAOAgent, msg.sender);
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
            cumulativeShares += prevRequest.cumulativeEther;
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

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    /// @notice Reverts when the contract is uninitialized
    modifier whenInitialized() {
        if (CONTRACT_VERSION_POSITION.getStorageUint256() == 0) {
            revert Uninitialized();
        }
        _;
    }

    /// @notice Reverts when the caller is not Lido DAO Agent
    modifier onlyLidoDAOAgent() {
        if (msg.sender != LIDO_DAO_AGENT_POSITION.getStorageAddress()) {
            revert LidoDAOAgentExpected(msg.sender);
        }
        _;
    }

    /// @notice Reverts when new withdrawal requests placement resumed
    modifier whenPaused() {
        if (REQUESTS_PLACEMENT_RESUMED_POSITION.getStorageBool()) {
            revert PausedRequestsPlacementExpected();
        }
        _;
    }

    /// @notice Reverts when new withdrawal requests placement paused
    modifier whenResumed() {
        if (!REQUESTS_PLACEMENT_RESUMED_POSITION.getStorageBool()) {
            revert ResumedRequestsPlacementExpected();
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
    event WithdrawalRequestsPlacementPaused();

    /// @notice Emitted when withdrawal requests placement resumed
    event WithdrawalRequestsPlacementResumed();

    /// @notice Emitted when the contract initialized
    /// @param _lidoDAOAgent provided Lido DAO Agent address
    /// @param _caller initialization `msg.sender`
    event InitializedV1(address _lidoDAOAgent, address _caller);

    event WithdrawalClaimed(uint256 indexed requestId, address indexed receiver, address initiator);

    error StETHInvalidAddress(address _stETH);
    error WstETHInvalidAddress(address _wstETH);
    error InvalidWithdrawalRequest(uint256 _requestId);
    error LidoDAOAgentZeroAddress();
    error LidoDAOAgentExpected(address _msgSender);
    error RecipientExpected(address _recipient, address _msgSender);
    error AlreadyInitialized();
    error Uninitialized();
    error Unimplemented();
    error PausedRequestsPlacementExpected();
    error ResumedRequestsPlacementExpected();
    error RequestAmountTooSmall(uint256 _amountOfStETH);
    error RequestAmountTooLarge(uint256 _amountOfStETH);
    error ZeroOwner();
    error InvalidFinalizationId();
    error NotEnoughEther();
    error RequestNotFinalized();
    error RequestAlreadyClaimed();
    error RateNotFound();
    error NotOwner();
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit96Bits();
    error SafeCastValueDoesNotFit128Bits();
}
