// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
// solhint-disable-next-line
pragma solidity 0.8.9;

import {MinFirstAllocationStrategy} from "../../contracts/common/lib/MinFirstAllocationStrategy.sol";

contract MinFirstAllocationStrategyTest {

    uint256[] public buckets;
    uint256[] public capacities;
    uint256[] public increments;

    modifier equalLengths {
        require (buckets.length == capacities.length, "lengths must be equal");
        require (buckets.length == increments.length, "lengths must be equal");
        _;
    }

    function getLength() public equalLengths view returns(uint256) {
        return buckets.length;
    }

    function allocate(uint256 allocationSize) public equalLengths returns(uint256 allocated) {
        uint256[] memory allocations = new uint256[](buckets.length);
        for (uint256 i = 0; i < buckets.length; ++i) {
            allocations[i] = buckets[i];
        } 
        allocated = MinFirstAllocationStrategy.allocate(allocations, capacities, allocationSize);
        for (uint256 i = 0; i < buckets.length; ++i) {
            increments[i] = allocations[i] - buckets[i];
        } 
    }

    function addBucket(uint256 bucket, uint256 capacity) public {
        buckets.push(bucket);
        capacities.push(capacity);
    }

    // Getters : array sums

    function sumOfBuckets() public view returns (uint256 sum) {
        sum = 0;
        for (uint256 i = 0; i < buckets.length; ++i) {
            sum += buckets[i];
        }
    }

    function sumOfIncrements() public view returns (uint256 sum) {
        sum = 0;
        for (uint256 i = 0; i < increments.length; ++i) {
            sum += increments[i];
        }
    }

    function sumOfCapacities() public view returns (uint256 sum) {
        sum = 0;
        for (uint256 i = 0; i < capacities.length; ++i) {
            sum += capacities[i];
        }
    }

    // Getters : arrays elements by index

    function getBucket(uint256 index) public view returns (uint256 bucket) {
        bucket = buckets[index];
    }

    function getIncrement(uint256 index) public view returns (uint256 increment) {
        increment = increments[index];
    }

    function getCapacity(uint256 index) public view returns (uint256 capacity) {
        capacity = capacities[index];
    }
}
