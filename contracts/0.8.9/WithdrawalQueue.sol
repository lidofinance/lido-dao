// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";

import "./lib/AragonUnstructuredStorage.sol";

interface IRestakingSink {
    function receiveRestake() external payable;
}

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
     * @notice structure representing share price for some range in request queue
     * @dev price is stored as a pair of value that should be divided later
     */
    struct Price {
        uint128 totalPooledEther;
        uint128 totalShares;
        /// @notice last index in queue this price is actual for
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
     * @notice minimal possible sum that is possible to withdraw
     * We don't want to deal with small amounts because there is a gas spent on oracle
     * for each request.
     * But exact threshold should be defined later when it will be clear how much will
     * it cost to withdraw.
     */
    uint256 public constant MIN_STETH_WITHDRAWAL_AMOUNT = 0.1 ether;
    /**
     * @notice maximum possible sum that is possible to withdraw by a single request
     * Prevents accumulating too much funds per single request fulfillment in the future.
     */
    uint256 public constant MAX_STETH_WITHDRAWAL_AMOUNT = 500 * 32 ether;

    /**
     * @notice All state-modifying calls are allowed only from owner protocol.
     * @dev should be Lido
     */
    address payable public immutable OWNER;

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///! SLOT 0: uint128 lockedEtherAmount
    ///! SLOT 1: uint256 finalizedRequestsCounter
    ///! SLOT 2: WithdrawalRequest[] queue
    ///! SLOT 3: mapping(address => uint256[]) requestsByRecipient
    ///! SLOT 4 Price[] finalizationPrices

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

    /// @notice finalization price history registry
    Price[] public finalizationPrices;

    /**
     * @param _owner address that will be able to invoke `restake` and `finalize` methods.
     * @param _stETH address of StETH contract
     * @param _wstETH address of WstETH contract
     */
    constructor(
        address payable _owner,
        address _stETH,
        address _wstETH
    ) {
        if (_owner == address(0)) revert ZeroOwner();

        // test stETH interface sanity
        if (
            (IStETH(_stETH).getPooledEthByShares(1 ether) == 0) || (IStETH(_stETH).getSharesByPooledEth(1 ether) == 0)
        ) {
            revert StETHInvalidAddress(_stETH);
        }
        // test wstETH interface sanity
        if (IWstETH(_wstETH).getStETHByWstETH(1 ether) != IStETH(_stETH).getPooledEthByShares(1 ether)) {
            revert WstETHInvalidAddress(_wstETH);
        }

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
    function requestWithdrawal(uint256 _amountOfStETH, address _recipient)
        external
        whenResumed
        returns (uint256 requestId)
    {
        _recipient = _checkWithdrawalRequestInput(_amountOfStETH, _recipient);
        return _requestWithdrawal(_amountOfStETH, _recipient);
    }

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

    function requestWithdrawalWstETH(uint256 _amountOfWstETH, address _recipient)
        external
        whenResumed
        returns (uint256 requestId)
    {
        _recipient = _checkWithdrawalRequestInput(IWstETH(WSTETH).getStETHByWstETH(_amountOfWstETH), _recipient);
        return _requestWithdrawalWstETH(_amountOfWstETH, _recipient);
    }

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
    function claimWithdrawalsBatch(
        uint256[] calldata /*_requests*/
    ) external pure {
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
            bool isFinalized,
            bool isClaimed
        )
    {
        if (_requestId < queue.length) {
            WithdrawalRequest memory request = queue[_requestId];

            recipient = request.recipient;
            requestBlockNumber = request.requestBlockNumber;
            uint256 shares = request.cumulativeShares;
            if (_requestId > 0) {
                shares -= queue[_requestId - 1].cumulativeShares;
            }
            etherToWithdraw = IStETH(STETH).getPooledEthByShares(shares);
            isFinalized = false;
            isClaimed = false;
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

    function _requestWithdrawalWstETH(uint256 _amountOfWstETH, address _recipient)
        internal
        returns (uint256 requestId)
    {
        IERC20(WSTETH).safeTransferFrom(msg.sender, address(this), _amountOfWstETH);
        uint256 amountOfStETH = IWstETH(WSTETH).unwrap(_amountOfWstETH);

        return _enqueue(amountOfStETH, _recipient);
    }

    function _checkWithdrawalRequestInput(uint256 _amountOfStETH, address _recipient)
        internal view returns (address)
    {
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

    /**
     * @notice Finalize the batch of requests started at `finalizedRequestsCounter` and ended at `_lastIdToFinalize` using the given price
     * @param _lastIdToFinalize request index in the queue that will be last finalized request in a batch
     * @param _etherToLock ether that should be locked for these requests
     * @param _totalPooledEther ether price component that will be used for this request batch finalization
     * @param _totalShares shares price component that will be used for this request batch finalization
     */
    function finalize(
        uint256 _lastIdToFinalize,
        uint256 _etherToLock,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external payable onlyOwner {
        if (_lastIdToFinalize < finalizedRequestsCounter || _lastIdToFinalize >= queue.length) {
            revert InvalidFinalizationId();
        }
        if (lockedEtherAmount + _etherToLock > address(this).balance) revert NotEnoughEther();

        _updatePriceHistory(_toUint128(_totalPooledEther), _toUint128(_totalShares), _lastIdToFinalize);

        lockedEtherAmount = _toUint128(_etherToLock);
        finalizedRequestsCounter = _lastIdToFinalize + 1;
    }

    /**
     * @notice Mark `_requestId` request as claimed and transfer reserved ether to recipient
     * @param _requestId request id to claim
     * @param _priceIndexHint price index found offchain that should be used for claiming
     */
    function claim(uint256 _requestId, uint256 _priceIndexHint) external returns (address recipient) {
        // request must be finalized
        if (finalizedRequestsCounter <= _requestId) revert RequestNotFinalized();

        WithdrawalRequest storage request = queue[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed();

        request.claimed = true;

        Price memory price;

        if (_isPriceHintValid(_requestId, _priceIndexHint)) {
            price = finalizationPrices[_priceIndexHint];
        } else {
            // unbounded loop branch. Can fail
            price = finalizationPrices[findPriceHint(_requestId)];
        }

        (uint128 etherToTransfer, ) = _calculateDiscountedBatch(
            _requestId,
            _requestId,
            price.totalPooledEther,
            price.totalShares
        );
        lockedEtherAmount -= etherToTransfer;

        _sendValue(request.recipient, etherToTransfer);

        emit WithdrawalClaimed(_requestId, recipient, msg.sender);

        return request.recipient;
    }

    /**
     * @notice calculates the params to fulfill the next batch of requests in queue
     * @param _lastIdToFinalize last id in the queue to finalize upon
     * @param _totalPooledEther share price component to finalize requests
     * @param _totalShares share price component to finalize requests
     *
     * @return etherToLock amount of eth required to finalize the batch
     * @return sharesToBurn amount of shares that should be burned on finalization
     */
    function calculateFinalizationParams(
        uint256 _lastIdToFinalize,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external view returns (uint256 etherToLock, uint256 sharesToBurn) {
        return _calculateDiscountedBatch(
            finalizedRequestsCounter,
            _lastIdToFinalize,
            _toUint128(_totalPooledEther),
            _toUint128(_totalShares)
        );
    }

    function findPriceHint(uint256 _requestId) public view returns (uint256 hint) {
        if (_requestId >= finalizedRequestsCounter) revert PriceNotFound();

        for (uint256 i = finalizationPrices.length; i > 0; i--) {
            if (_isPriceHintValid(_requestId, i - 1)) {
                return i - 1;
            }
        }
        assert(false);
    }

    function restake(uint256 _amount) external onlyOwner {
        if (lockedEtherAmount + _amount > address(this).balance) revert NotEnoughEther();

        IRestakingSink(OWNER).receiveRestake{value: _amount}();
    }

    function _calculateDiscountedBatch(
        uint256 firstId,
        uint256 lastId,
        uint128 _totalPooledEther,
        uint128 _totalShares
    ) internal view returns (uint128 eth, uint128 shares) {
        eth = queue[lastId].cumulativeEther;
        shares = queue[lastId].cumulativeShares;

        if (firstId > 0) {
            eth -= queue[firstId - 1].cumulativeEther;
            shares -= queue[firstId - 1].cumulativeShares;
        }

        eth = _min(eth, (shares * _totalPooledEther) / _totalShares);
    }

    function _isPriceHintValid(uint256 _requestId, uint256 hint) internal view returns (bool isInRange) {
        uint256 hintLastId = finalizationPrices[hint].index;

        isInRange = _requestId <= hintLastId;
        if (hint > 0) {
            uint256 previousId = finalizationPrices[hint - 1].index;

            isInRange = isInRange && previousId < _requestId;
        }
    }

    function _updatePriceHistory(uint128 _totalPooledEther, uint128 _totalShares, uint256 index) internal {
        if (finalizationPrices.length == 0) {
            finalizationPrices.push(Price(_totalPooledEther, _totalShares, index));
        } else {
            Price storage lastPrice = finalizationPrices[finalizationPrices.length - 1];

            if (_totalPooledEther / _totalShares == lastPrice.totalPooledEther / lastPrice.totalShares) {
                lastPrice.index = index;
            } else {
                finalizationPrices.push(Price(_totalPooledEther, _totalShares, index));
            }
        }
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
    error PriceNotFound();
    error NotOwner();
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit96Bits();
    error SafeCastValueDoesNotFit128Bits();
}
