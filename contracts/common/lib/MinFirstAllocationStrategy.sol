// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity >=0.4.24 <0.9.0;

import {Math256} from "./Math256.sol";

/// @notice Library with methods to calculate "proportional" allocations among baskets with different
///     capacity and level of filling.
/// @dev The current implementation favors baskets with the least fill factor
library MinFirstAllocationStrategy {
    uint256 private constant MAX_UINT256 = 2**256 - 1;

    /// @notice Allocates passed maxAllocationSize among the baskets. The resulting allocation doesn't exceed the
    ///     capacities of the baskets. An algorithm starts filling from the least populated baskets to equalize the fill factor.
    ///     For example, for baskets: [9998, 70, 0], capacities: [10000, 101, 100], and maxAllocationSize: 101, the allocation happens
    ///     following way:
    ///         1. top up the basket with index 2 on 70. Intermediate state of the baskets: [9998, 70, 70]. According to the definition,
    ///            the rest allocation must be proportionally split among the baskets with the same values.
    ///         2. top up the basket with index 1 on 15. Intermediate state of the baskets: [9998, 85, 70].
    ///         3. top up the basket with index 2 on 15. Intermediate state of the baskets: [9998, 85, 85].
    ///         4. top up the basket with index 1 on 1. Nothing to distribute. The final state of the baskets: [9998, 86, 85]
    /// @dev Method modifies the passed baskets array to reduce the gas costs on memory allocation.
    /// @param baskets The array of current allocations in the baskets
    /// @param capacities The array of capacities of the baskets
    /// @param allocationSize The desired value to allocate among the baskets
    /// @return allocated The total value allocated among the baskets. Can't exceed the allocationSize value
    function allocate(
        uint256[] memory baskets,
        uint256[] memory capacities,
        uint256 allocationSize
    ) internal pure returns (uint256 allocated) {
        uint256 allocatedToBestCandidate = 0;
        while (allocated < allocationSize) {
            allocatedToBestCandidate = allocateToBestCandidate(baskets, capacities, allocationSize - allocated);
            if (allocatedToBestCandidate == 0) {
                break;
            }
            allocated += allocatedToBestCandidate;
        }
    }

    /// @notice Allocates the max allowed value not exceeding allocationSize to the basket with the least value.
    ///     The candidate search happens according to the following algorithm:
    ///         1. Find the first least filled basket which has free space. Count the number of such baskets.
    ///         2. If no baskets are found terminate the search - no free baskets
    ///         3. Find the first basket with free space, which has the least value greater
    ///             than the basket found in step 1. To preserve proportional allocation the resulting allocation can't exceed this value.
    ///         4. Calculate the allocation size as:
    ///             min(
    ///                 max(allocationSize / count of least filling baskets, 1),
    ///                 fill factor of the basket found in step 3,
    ///                 free space of the least filled basket
    ///             )
    /// @dev Method modifies the passed baskets array to reduce the gas costs on memory allocation.
    /// @param baskets The array of current allocations in the baskets
    /// @param capacities The array of capacities of the baskets
    /// @param allocationSize The desired value to allocate to the basket
    /// @return allocated The total value allocated to the basket. Can't exceed the allocationSize value
    function allocateToBestCandidate(
        uint256[] memory baskets,
        uint256[] memory capacities,
        uint256 allocationSize
    ) internal pure returns (uint256 allocated) {
        uint256 bestCandidateIndex = baskets.length;
        uint256 bestCandidateAllocation = MAX_UINT256;
        uint256 bestCandidatesCount = 0;

        for (uint256 i = 0; i < baskets.length; ++i) {
            if (baskets[i] >= capacities[i]) {
                continue;
            } else if (bestCandidateAllocation > baskets[i]) {
                bestCandidateIndex = i;
                bestCandidatesCount = 1;
                bestCandidateAllocation = baskets[i];
            } else if (bestCandidateAllocation == baskets[i]) {
                bestCandidatesCount += 1;
            }
        }

        if (bestCandidatesCount == 0 || allocationSize == 0) {
            return 0;
        }

        // cap the allocation by the smallest larger allocation than the found best one
        uint256 allocationSizeUpperBound = MAX_UINT256;
        for (uint256 j = 0; j < baskets.length; ++j) {
            if (baskets[j] >= capacities[j]) {
                continue;
            } else if (baskets[j] > bestCandidateAllocation && baskets[j] < allocationSizeUpperBound) {
                allocationSizeUpperBound = baskets[j];
            }
        }

        // allocate at least one item per iteration
        allocationSize = Math256.max(allocationSize / bestCandidatesCount, 1);

        allocated = Math256.min(
            allocationSize,
            Math256.min(allocationSizeUpperBound, capacities[bestCandidateIndex]) - bestCandidateAllocation
        );
        baskets[bestCandidateIndex] += allocated;
    }
}
