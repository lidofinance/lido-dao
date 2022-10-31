// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

//TODO(security): Replace to in-repo copy of the lib
import "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";
import "@openzeppelin/contracts-v4.4/utils/Address.sol";


/**
 * @title A dedicated contract for handling stETH withdrawal request queue
 * @author folkyatina
 */
contract WithdrawalQueue {
    using SafeCast for uint256;
    using Address for address payable;

    /**
     * @notice minimal possible sum that is possible to withdraw
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

    /// @notice queue for withdrawal requests
    Request[] public queue;
    
    /// @notice length of the finalized part of the queue
    uint256 public finalizedQueueLength = 0;

    /// @notice structure representing a request for withdrawal.
    struct Request {
        /// @notice payable address of the recipient withdrawal will be transfered to
        address payable recipient;
        /// @notice block.number when the request created
        uint96 requestBlockNumber;
        /// @notice sum of the all requested ether including this request
        uint256 cumulativeEther;
        /// @notice sum of the all shares locked for withdrawal including this request
        uint256 cumulativeShares;
        /// @notice flag if the request was already claimed
        bool claimed;
    }

    /// @notice finalization price history registry
    Price[] public finalizationPrices;

    /**
     * @notice structure representing share price for some range in request queue
     * @dev price is stored as a pair of value that should be devided later
     */ 
    struct Price {
        uint128 totalPooledEther;
        uint128 totalShares;
        /// @notice last index in queue this price is actual for
        uint256 index;
    }

    /**
     * @param _owner address that will be able to invoke `enqueue` and `finalize` methods.
     */
    constructor(address _owner) {
        OWNER = _owner;
    }

    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    /**
     * @notice put a withdrawal request in a queue and associate it with `_recipient` address
     * @dev Assumes that `_ethAmount` of stETH is locked before invoking this function 
     * @param _recipient payable address this request will be associated with
     * @param _etherAmount maximum amount of ether (equal to amount of locked stETH) that will be claimed upon withdrawal
     * @param _sharesAmount amount of stETH shares that will be burned upon withdrawal
     * @return requestId unique id to claim funds once it is available
     */
    function enqueue(
        address payable _recipient, 
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
            _recipient, 
            block.number.toUint96(), 
            cumulativeEther,
            cumulativeShares,
            false
        ));
    }

    /**
     * @notice Finalize the batch of requests started at `finalizedQueueLength` and ended at `_lastIdToFinalize` using the given price
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
     * @notice Mark `_requestId` request as claimed and transfer reserved ether to recipient
     * @param _requestId request id to claim
     * @param _priceIndexHint price index found offchain that should be used for claiming 
     */
    function claim(uint256 _requestId, uint256 _priceIndexHint) external returns (address recipient) {
        // request must be finalized
        require(finalizedQueueLength > _requestId, "REQUEST_NOT_FINALIZED");

        Request storage request = queue[_requestId];
        require(!request.claimed, "REQUEST_ALREADY_CLAIMED");

        request.claimed = true;

        Price memory price;

        if (_isPriceHintValid(_requestId, _priceIndexHint)) {
            price = finalizationPrices[_priceIndexHint];
        } else {
            // unbounded loop branch. Can fail
            price = finalizationPrices[findPriceHint(_requestId)];
        }

        (uint256 etherToTransfer,) = _calculateDiscountedBatch(
            _requestId, 
            _requestId, 
            price.totalPooledEther, 
            price.totalShares
        );
        lockedEtherAmount -= etherToTransfer;

        request.recipient.sendValue(etherToTransfer);
    }

    /**
     * @notice calculates the params to fullfill the next batch of requests in queue
     * @param _lastIdToFinalize last id in the queue to finalize upon 
     * @param _totalPooledEther share price compoinent to finalize requests
     * @param _totalShares share price compoinent to finalize requests
     * 
     * @return etherToLock amount of eth required to finalize the batch
     * @return sharesToBurn amount of shares that should be burned on finalization
     */
    function calculateFinalizationParams(
        uint256 _lastIdToFinalize,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external view returns (uint256 etherToLock, uint256 sharesToBurn) {
        return _calculateDiscountedBatch(finalizedQueueLength, _lastIdToFinalize, _totalPooledEther, _totalShares);
    }

    function findPriceHint(uint256 _requestId) public view returns (uint256 hint) {
        require(_requestId < finalizedQueueLength, "PRICE_NOT_FOUND");

        for (uint256 i = finalizationPrices.length - 1; i >= 0; i--) {
            if (_isPriceHintValid(_requestId, i)){
                return i;
            }
        }
        assert(false);
    } 

    function _calculateDiscountedBatch(
        uint256 firstId, 
        uint256 lastId, 
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) internal view returns (uint256 eth, uint256 shares) {
        eth = queue[lastId].cumulativeEther;
        shares = queue[lastId].cumulativeShares;

        if (firstId > 0) {
            eth -= queue[firstId - 1].cumulativeEther;
            shares -= queue[firstId - 1].cumulativeShares;
        }

        eth = _min(eth, shares * _totalPooledEther / _totalShares);
    }

    function _isPriceHintValid(uint256 _requestId, uint256 hint) internal view returns (bool isInRange) {
        uint256 hintLastId = finalizationPrices[hint].index;

        isInRange = _requestId <= hintLastId;
        if (hint > 0) {
            uint256 previousId = finalizationPrices[hint - 1].index;
           
            isInRange = isInRange && previousId < _requestId;
        } 
    }

    function _updatePriceHistory(uint256 _totalPooledEther, uint256 _totalShares, uint256 index) internal {
        if (finalizationPrices.length == 0) {
            finalizationPrices.push(Price(_totalPooledEther.toUint128(), _totalShares.toUint128(), index));
        } else {
            Price storage lastPrice = finalizationPrices[finalizationPrices.length - 1];

            if (_totalPooledEther/_totalShares == lastPrice.totalPooledEther/lastPrice.totalShares) {
                lastPrice.index = index;
            } else {
                finalizationPrices.push(Price(_totalPooledEther.toUint128(), _totalShares.toUint128(), index));
            }
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;  
    }

    modifier onlyOwner() {
        require(msg.sender == OWNER, "NOT_OWNER");
        _;
    }
}
