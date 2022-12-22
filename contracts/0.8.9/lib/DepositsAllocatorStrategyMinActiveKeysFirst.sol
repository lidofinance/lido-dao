// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {Math} from "./Math.sol";

library DepositsAllocatorStrategyMinActiveKeysFirst {
    struct AllocationCandidate {
        uint256 activeKeysCount;
        uint256 availableKeysCount;
    }

    function allocate(AllocationCandidate[] memory candidates, uint256 keysToDistribute)
        internal
        pure
        returns (uint256[] memory keysDistribution, uint256 distributedKeysCount)
    {
        keysDistribution = new uint256[](candidates.length);
        while (distributedKeysCount < keysToDistribute) {
            (uint256 candidateIndex, uint256 keysDistributed) = _getNextCandidate(
                candidates,
                keysToDistribute - distributedKeysCount
            );
            if (keysDistributed == 0) {
                break;
            }
            candidates[candidateIndex].activeKeysCount += keysDistributed;
            candidates[candidateIndex].availableKeysCount -= keysDistributed;
            keysDistribution[candidateIndex] += keysDistributed;
            distributedKeysCount += keysDistributed;
        }
    }

    function _getNextCandidate(AllocationCandidate[] memory candidates, uint256 keysToDistribute)
        private
        pure
        returns (uint256 nextCandidateIndex, uint256 keysDistributed)
    {
        uint256 candidatesCount = 1;
        // find the candidate with the lowest number of the active keys count
        for (uint256 i = 1; i < candidates.length; ++i) {
            if (candidates[nextCandidateIndex].activeKeysCount > candidates[i].activeKeysCount) {
                nextCandidateIndex = i;
                candidatesCount = 1;
            } else if (candidates[nextCandidateIndex].activeKeysCount == candidates[i].activeKeysCount) {
                candidatesCount += 1;
            }
        }

        // bound the max number of keys to distribute to the candidate by the lowest active keys count
        // after the found candidate
        uint256 availableKeysCountLimit = type(uint256).max;
        uint256 nextCandidateActiveKeysCount = candidates[nextCandidateIndex].activeKeysCount;
        for (uint256 i = 0; i < candidates.length; ++i) {
            if (
                candidates[i].activeKeysCount > nextCandidateActiveKeysCount &&
                candidates[i].activeKeysCount < availableKeysCountLimit
            ) {
                availableKeysCountLimit = candidates[i].activeKeysCount;
            }
        }

        keysDistributed = Math.min(availableKeysCountLimit, candidates[nextCandidateIndex].availableKeysCount);
        keysDistributed = Math.min(keysDistributed, keysToDistribute / candidatesCount);
    }
}
