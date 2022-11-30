// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";

import "./lib/AragonUnstructuredStorage.sol";

/**
 * @title Interface defining a Lido liquid staking pool
 * @dev see also [Lido liquid staking pool core contract](https://docs.lido.fi/contracts/lido)
 */
interface ILido {
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

contract WithdrawalQueueEarlyCommitment {
    using SafeERC20 for IERC20;
    using UnstructuredStorage for bytes32;

    /// @notice structure representing a request for withdrawal.
    struct WithdrawalRequest {
        /// @notice sum of the all requested ether including this request
        uint128 cumulativeEther;
        /// @notice sum of the all shares locked for withdrawal including this request
        uint128 cumulativeShares;
        /// @notice payable address of the recipient withdrawal will be transfered to
        address payable recipient;
        /// @notice block.number when the request created
        uint64 requestBlockNumber;
        /// @notice flag if the request was already claimed
        bool claimed;
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
    address public immutable LIDO;

    /**
     * @notice minimal possible sum that is possible to withdraw
     * We don't want to deal with small amounts because there is a gas spent on oracle
     * for each request.
     * But exact threshhold should be defined later when it will be clear how much will
     * it cost to withdraw.
     */
    uint256 public constant MIN_STETH_WITHDRAWAL_AMOUNT = 0.1 ether;
    /**
     * @notice maximum possible sum that is possible to withdraw by a single request
     * Prevents accumulating too much funds per single request fulfillment in the future.
     */
    uint256 public constant MAX_STETH_WITHDRAWAL_AMOUNT = 500 * 32 ether;

    ///! STRUCTURED STORAGE OF THE CONTRACT
    ///! SLOT 0: WithdrawalRequest[] queue
    ///! SLOT 1: mapping(address => uint256[]) requestsByRecipient

    /// @notice queue for withdrawal requests
    WithdrawalRequest[] public queue;

    /// @notice withdrawal requests mapped to the recipients
    mapping(address => uint256[]) requestsByRecipient;

    constructor(address _lido) {
        // test Lido interface sanity
        if ((ILido(_lido).getPooledEthByShares(1 ether) == 0) || (ILido(_lido).getSharesByPooledEth(1 ether) == 0)) {
            revert LidoInvalidAddress(_lido);
        }
        LIDO = _lido;

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

    /// @notice Requests withdrawal of the provided stETH token amount
    function requestWithdrawal(uint256 _amountOfStETH) external whenResumed returns (uint256 requestId) {
        if (_amountOfStETH < MIN_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooSmall(_amountOfStETH);
        }
        if (_amountOfStETH > MAX_STETH_WITHDRAWAL_AMOUNT) {
            revert RequestAmountTooLarge(_amountOfStETH);
        }

        IERC20(LIDO).safeTransferFrom(msg.sender, address(this), _amountOfStETH);

        requestId = queue.length;
        uint256 shares = ILido(LIDO).getSharesByPooledEth(_amountOfStETH);

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
                payable(msg.sender),
                uint64(block.number),
                false
            )
        );
        requestsByRecipient[msg.sender].push(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _amountOfStETH, shares);
    }

    /// @notice Claim withdrawal once finalized (claimable)
    /// NB: Always reverts
    function claimWithdrawal(
        uint256 /*_requestId*/
    ) external pure {
        revert Unimplemented();
    }

    /// @notice Returns withdrawal requests placed by the `_requestsFrom` address
    function getWithdrawalRequests(address _requestsFrom) external view returns (uint256[] memory requestsIds) {
        return requestsByRecipient[_requestsFrom];
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
            etherToWithdraw = ILido(LIDO).getPooledEthByShares(shares);
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

        emit Initialized(_lidoDAOAgent, msg.sender);
    }

    /// @notice Reverts when the contract is unititialized
    modifier whenInitialized() {
        if (CONTRACT_VERSION_POSITION.getStorageUint256() == 0) {
            revert Unitialized();
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
    event Initialized(address _lidoDAOAgent, address _caller);

    error LidoInvalidAddress(address _lido);
    error LidoDAOAgentZeroAddress();
    error LidoDAOAgentExpected(address _msgSender);
    error AlreadyInitialized();
    error Unitialized();
    error Unimplemented();
    error PausedRequestsPlacementExpected();
    error ResumedRequestsPlacementExpected();
    error RequestAmountTooSmall(uint256 _amountOfStETH);
    error RequestAmountTooLarge(uint256 _amountOfStETH);
}
