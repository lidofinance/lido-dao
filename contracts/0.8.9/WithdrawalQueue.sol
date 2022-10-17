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
    mapping(uint => Request) public queue;
    
    uint256 public queueLength = 0;
    uint256 public finalizedQueueLength = 0;

    struct Request {
        address requestor;
        uint96 requestBlockNumber;
        uint128 etherAmount;
        uint128 sharesAmount;
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
        requestId = queueLength++;
        queue[requestId] = Request(
            _requestor, 
            block.number.toUint96(), 
            _etherAmount.toUint128(), 
            _sharesAmount.toUint128()
        );
    }

    /**
     * @notice Mark next requests in queue as finalized and lock the respective amount of ether for withdrawal.
     * @dev expected that `lastIdToFinalize` is chosen by following criteria:
     *  - it was created before the oracle report block
     *  - we have enough money on wc balance to fullfill it
     */
    function finalize(
        uint256 _lastIdToFinalize, 
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external payable onlyOwner returns (uint sharesToBurn) {
        uint etherToLock = 0;
        for (uint i = finalizedQueueLength; i <= _lastIdToFinalize; i++) {
            uint requestShares = queue[i].sharesAmount;
            uint requestEther = queue[i].etherAmount;

             // discount for slashing
            uint256 discountedEther = _totalPooledEther * requestShares / _totalShares;
            if (discountedEther < requestEther) {
                queue[i].etherAmount = discountedEther.toUint128();
                requestEther = discountedEther;
            }

            sharesToBurn += requestShares;
            etherToLock += requestEther;
        }

        require(lockedEtherAmount + etherToLock <= address(this).balance, "NOT_ENOUGH_ETHER");

        lockedEtherAmount += etherToLock;
        finalizedQueueLength = _lastIdToFinalize + 1; 
    }

    /**
     * @notice Evict a `_requestId` request from the queue and transfer reserved ether to `_to` address. 
     */
    function claim(uint256 _requestId) external returns (address recipient) {
        // request must be finalized
        require(finalizedQueueLength > _requestId, "REQUEST_NOT_FINALIZED");

        // transfer designated amount to request owner
        recipient = requestor(_requestId);
        uint256 etherAmount = queue[_requestId].etherAmount;

        lockedEtherAmount -= etherAmount;

         // free storage to save some gas
        delete queue[_requestId];

        payable(recipient).transfer(etherAmount);
    }

    function requestor(uint256 _requestId) public view returns (address result) {
        result = queue[_requestId].requestor;
        require(result != address(0), "REQUEST_NOT_FOUND");
    }

    function _exists(uint256 _requestId) internal view returns (bool) {
        return queue[_requestId].requestor != address(0);
    }

    modifier onlyOwner() {
        require(msg.sender == OWNER, "NOT_OWNER");
        _;
    }
}
