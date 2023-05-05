// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// solhint-disable-next-line
pragma solidity >=0.4.24 <0.9.0;

import {console2} from "forge-std/console2.sol";

import {Math256} from "contracts/common/lib/Math256.sol";
import {MinFirstAllocationStrategy} from "contracts/common/lib/MinFirstAllocationStrategy.sol";

contract MinFirstAllocationStrategyFuzzTesting {
    uint256 private constant MAX_BUCKETS_COUNT = 32;
    uint256 private constant MAX_BUCKET_VALUE = 8192;
    uint256 private constant MAX_CAPACITY_VALUE = 8192;
    uint256 private constant MAX_ALLOCATION_SIZE = 1024;

    MinFirstAllocationStrategyTestWrapper internal testWrapper;

    function invariant_allocated_output() external view {
        (, , uint256 allocatedActual) = testWrapper.getActualOutput();
        (, , uint256 allocatedExpected) = testWrapper.getExpectedOutput();
        _assertAllocated(allocatedExpected, allocatedActual);
    }

    function invariant_buckets_output() external view {
        (uint256[] memory bucketsActual, , ) = testWrapper.getActualOutput();
        (uint256[] memory bucketsExpected, , ) = testWrapper.getExpectedOutput();
        _assertBucketsAllocation(bucketsExpected, bucketsActual);
    }

    function invariant_allocated_bucket_values_not_exceed_capacities() external view {
        (uint256[] memory inputBuckets, uint256[] memory inputCapacities, ) = testWrapper.getInput();
        (uint256[] memory buckets, uint256[] memory capacities, ) = testWrapper.getActualOutput();
        for (uint256 i = 0; i < buckets.length; ++i) {
            // when bucket initially overloaded skip it from the check
            if (inputBuckets[i] > inputCapacities[i]) continue;
            if (buckets[i] > capacities[i]) {
                console2.log("Bucket value exceeds capacity");
                console2.log("bucket index: ", i);
                console2.log("bucket value:", buckets[i]);
                console2.log("capacity value:", capacities[i]);
                revert("BUCKET_VALUE_EXCEEDS_CAPACITY");
            }
        }
    }

    // invariant 5. the sum of new allocation minus the sum of prev allocation equal to distributed
    function invariant_allocated_matches_bucket_changes() external view {
        (uint256[] memory inputBuckets, , ) = testWrapper.getInput();
        (uint256[] memory buckets, , uint256 allocated) = testWrapper.getActualOutput();
        uint256 inputSum = 0;
        uint256 outputSum = 0;
        for (uint256 i = 0; i < buckets.length; ++i) {
            inputSum += inputBuckets[i];
            outputSum += buckets[i];
        }
        if (outputSum != inputSum + allocated) {
            console2.log("Sum of all buckets is incorrect");
            console2.log("expected buckets sum:", inputSum + allocated);
            console2.log("actual buckets sum:", outputSum);
            revert("INVALID_BUCKETS_SUM");
        }
    }

    function invariant_allocated_less_then_allocation_size_only_when_all_buckets_filled() external view {
        (, , uint256 allocationSize) = testWrapper.getInput();
        (uint256[] memory buckets, uint256[] memory capacities , uint256 allocated) = testWrapper.getActualOutput();
        if (allocationSize == allocated) return;
        for (uint256 i = 0; i < buckets.length; ++i) {
            if (buckets[i] < capacities[i]) {
                console2.log("The bucket is unfilled");
                console2.log("bucket index:", i);
                console2.log("bucket value:", buckets[i]);
                console2.log("bucket capacity:", capacities[i]);
                revert("BUCKET_IS_UNFILLED");
            }
        }
    }

    function _assertAllocated(uint256 _expected, uint256 _actual) internal view {
        if (_expected != _actual) {
            console2.log("Invalid allocated value");
            console2.log("expected allocated value: ", _expected);
            console2.log("actual allocated value:", _actual);
            revert("INVALID_ALLOCATED_VALUE");
        }
    }

    function _assertBucketsAllocation(uint256[] memory _expected, uint256[] memory _actual) internal view {
        for (uint256 i = 0; i < _expected.length; ++i) {
            if (_expected[i] != _actual[i]) {
                console2.log("Invalid bucket value after allocation:");
                console2.log("bucket index:", i);
                console2.log("expected bucket value:", _expected[i]);
                console2.log("actual bucket value:", _actual[i]);
                revert("INVALID_ALLOCATED_VALUE");
            }
        }
    }
}

contract MinFirstAllocationStrategyTestWrapper {
    uint256 public constant MAX_BUCKETS_COUNT = 32;
    uint256 public constant MAX_BUCKET_VALUE = 8192;
    uint256 public constant MAX_CAPACITY_VALUE = 8192;
    uint256 public constant MAX_ALLOCATION_SIZE = 1024;

    struct TestInput {
        uint256[] buckets;
        uint256[] capacities;
        uint256 allocationSize;
    }

    struct TestOutput {
        uint256[] buckets;
        uint256[] capacities;
        uint256 allocated;
    }

    TestInput internal _input;
    TestOutput internal _actual;
    TestOutput internal _expected;

    function getInput()
        external
        view
        returns (
            uint256[] memory buckets,
            uint256[] memory capacities,
            uint256 allocationSize
        )
    {
        buckets = _input.buckets;
        capacities = _input.capacities;
        allocationSize = _input.allocationSize;
    }

    function getExpectedOutput()
        external
        view
        returns (
            uint256[] memory buckets,
            uint256[] memory capacities,
            uint256 allocated
        )
    {
        buckets = _expected.buckets;
        capacities = _expected.capacities;
        allocated = _expected.allocated;
    }

    function getActualOutput()
        external
        view
        returns (
            uint256[] memory buckets,
            uint256[] memory capacities,
            uint256 allocated
        )
    {
        buckets = _actual.buckets;
        capacities = _actual.capacities;
        allocated = _actual.allocated;
    }

    function _fillTestInput(
        uint256[] memory _fuzzBuckets,
        uint256[] memory _fuzzCapacities,
        uint256 _fuzzAllocationSize
    ) internal {
        uint256 bucketsCount = Math256.min(_fuzzBuckets.length, _fuzzCapacities.length) % MAX_BUCKETS_COUNT;
        _input.buckets = new uint256[](bucketsCount);
        _input.capacities = new uint256[](bucketsCount);
        for (uint256 i = 0; i < bucketsCount; ++i) {
            _input.buckets[i] = _fuzzBuckets[i] % MAX_BUCKET_VALUE;
            _input.capacities[i] = _fuzzCapacities[i] % MAX_CAPACITY_VALUE;
        }
        _input.allocationSize = _fuzzAllocationSize % MAX_ALLOCATION_SIZE;
    }
}

contract MinFirstAllocationStrategyAllocateTestWrapper is MinFirstAllocationStrategyTestWrapper {
    function allocate(
        uint256[] memory _fuzzBuckets,
        uint256[] memory _fuzzCapacities,
        uint256 _fuzzAllocationSize
    ) public {
        _fillTestInput(_fuzzBuckets, _fuzzCapacities, _fuzzAllocationSize);

        _fillActualAllocateOutput();
        _fillExpectedAllocateOutput();
    }

    function _fillExpectedAllocateOutput() internal {
        uint256[] memory buckets = _input.buckets;
        uint256[] memory capacities = _input.capacities;
        uint256 allocationSize = _input.allocationSize;

        uint256 allocated = NaiveMinFirstAllocationStrategy.allocate(buckets, capacities, allocationSize);

        _expected.allocated = allocated;
        _expected.buckets = buckets;
        _expected.capacities = capacities;
    }

    function _fillActualAllocateOutput() internal {
        uint256[] memory buckets = _input.buckets;
        uint256[] memory capacities = _input.capacities;
        uint256 allocationSize = _input.allocationSize;

        uint256 allocated = MinFirstAllocationStrategy.allocate(buckets, capacities, allocationSize);

        _actual.allocated = allocated;
        _actual.buckets = buckets;
        _actual.capacities = capacities;
    }
}

library NaiveMinFirstAllocationStrategy {
    uint256 private constant MAX_UINT256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    function allocate(
        uint256[] memory buckets,
        uint256[] memory capacities,
        uint256 allocationSize
    ) internal pure returns (uint256 allocated) {
        while (allocated < allocationSize) {
            uint256 bestCandidateIndex = MAX_UINT256;
            uint256 bestCandidateAllocation = MAX_UINT256;
            for (uint256 i = 0; i < buckets.length; ++i) {
                if (buckets[i] >= capacities[i]) continue;
                if (buckets[i] < bestCandidateAllocation) {
                    bestCandidateAllocation = buckets[i];
                    bestCandidateIndex = i;
                }
            }
            if (bestCandidateIndex == MAX_UINT256) break;
            buckets[bestCandidateIndex] += 1;
            allocated += 1;
        }
    }
}
