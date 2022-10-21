// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

//TODO(security): Replace to in-repo copy of the lib
import "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";


/**
  * @title A dedicated contract for handling stETH withdrawal request queue
  * @notice it responsible for:
  * - taking withdrawal requests and placing them in the queue
  * - finalizing requesuts in queue (making them claimable)
  * - processing claims for finalized requests
  * @author folkyatina
  */
contract WithdrawalQueue {
    using SafeCast for uint256;
    /**
     * We don't want to deal with small amounts because there is a gas spent on oracle 
     * for each request. 
     * But exact threshhold should be defined later when it will be clear how much will 
     * it cost to withdraw.
     */
    uint256 public constant MIN_WITHDRAWAL = 0.1 ether;

    /**
     * @notice All state-modifying calls are allowed only from owner protocol. 
     * @dev should be Lido
     */ 
    address public immutable OWNER;

    /**
     * @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
     * @dev Invariant: `lockedEtherAmount <= this.balance`
     */
    uint256 public lockedEtherAmount = 0;

    /**
     * @notice queue for withdrawal requests
     */ 
    Request[] public queue;
    
    uint256 public finalizedQueueLength = 0;

    struct Request {
        address requestor;
        uint96 requestBlockNumber;
        uint256 cumulativeEther;
        uint256 cumulativeShares;
        bool claimed;
    }

    Price[] public priceHistory;

    struct Price {
        uint128 totalPooledEther;
        uint128 totalShares;
        uint256 index;
    }

    constructor(address _owner) {
        OWNER = _owner;
    }

    /**
     * @notice reserve a place in queue for withdrawal request and associate it with `_recipient` address
     * @dev Assumes that `_ethAmount` of stETH is locked before invoking this function 
     * @return requestId unique id to withdraw funds once it is available
     */
    function enqueue(
        address _requestor, 
        uint256 _etherAmount, 
        uint256 _sharesAmount
    ) external onlyOwner returns (uint256 requestId) {
        require(_etherAmount > MIN_WITHDRAWAL, "WITHDRAWAL_IS_TOO_SMALL");
        requestId = queue.length;

        uint256 cumulativeEther = _etherAmount;
        uint256 cumulativeShares = _sharesAmount;
        
        if (requestId > 0) {
            cumulativeEther += queue[requestId - 1].cumulativeEther;
            cumulativeShares += queue[requestId - 1].cumulativeShares;
        }
        
        queue.push(Request(
            _requestor, 
            block.number.toUint96(), 
            cumulativeEther,
            cumulativeShares,
            false
        ));
    }

    /**
     * @notice Mark next requests in queue as finalized and lock the respective amount of ether for withdrawal.
     * @dev expected that `lastIdToFinalize` is chosen by following criteria:
     *  - it was created before the oracle report block
     *  - we have enough money on wc balance to fullfill it
     */
    function finalize(
        uint256 _lastIdToFinalize, 
        uint256 _etherToLock,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external payable onlyOwner {
        require(
            _lastIdToFinalize >= finalizedQueueLength && _lastIdToFinalize < queue.length, 
            "INVALID_FINALIZATION_ID"
        );
        require(lockedEtherAmount + _etherToLock <= address(this).balance, "NOT_ENOUGH_ETHER");

        _updatePriceHistory(_totalPooledEther, _totalShares, _lastIdToFinalize);

        lockedEtherAmount += _etherToLock;
        finalizedQueueLength = _lastIdToFinalize + 1; 
    }

    /**
     * @notice Evict a `_requestId` request from the queue and transfer reserved ether to `_to` address. 
     */
    function claim(uint256 _requestId, uint256 _priceIndexHint) external returns (address recipient) {
        // request must be finalized
        require(finalizedQueueLength > _requestId, "REQUEST_NOT_FINALIZED");

        // TODO: find a right price in history, mark request as claimed and transfer ether
    }

    function requestor(uint256 _requestId) public view returns (address) {
        require(_requestId < queue.length, "REQUEST_NOT_FOUND");
        return queue[_requestId].requestor;
    }

    function calculateFinalizationParams(
        uint256 _lastIdToFinalize,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external view returns (uint256 sharesToBurn, uint256 etherToLock) {
        Request storage lastFinalized = queue[finalizedQueueLength - 1];
        Request storage toFinalize = queue[_lastIdToFinalize];
        
        uint256 batchEther = toFinalize.cumulativeEther - lastFinalized.cumulativeEther;

        sharesToBurn = toFinalize.cumulativeShares - lastFinalized.cumulativeShares;
        etherToLock = _totalPooledEther * sharesToBurn / _totalShares;

        if (batchEther < etherToLock) {
            etherToLock = batchEther;
        }
    }

    function _updatePriceHistory(uint256 _totalPooledEther, uint256 _totalShares, uint256 index) internal {
        Price storage lastPrice = priceHistory[priceHistory.length - 1];

        if (_totalPooledEther/_totalShares == lastPrice.totalPooledEther/lastPrice.totalShares) {
            lastPrice.index = index;
        } else {
            priceHistory.push(Price(_totalPooledEther.toUint128(), _totalShares.toUint128(), index));
        }
    }

    function _exists(uint256 _requestId) internal view returns (bool) {
        return queue[_requestId].requestor != address(0);
    }

    modifier onlyOwner() {
        require(msg.sender == OWNER, "NOT_OWNER");
        _;
    }
}
