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
        for (uint256 i = 1; i < candidates.length; ++i) {
            if (candidates[nextCandidateIndex].activeKeysCount > candidates[i].activeKeysCount) {
                nextCandidateIndex = i;
                candidatesCount = 1;
            } else if (candidates[nextCandidateIndex].activeKeysCount == candidates[i].activeKeysCount) {
                candidatesCount += 1;
                // second sort based on availableKeysCount. Always take the lowest one.
                if (candidates[nextCandidateIndex].availableKeysCount > candidates[i].availableKeysCount) {
                    nextCandidateIndex = i;
                }
            }
        }

        uint256 nextCandidateSuccessorIndex = 0;
        for (uint256 i = 1; i < candidates.length; ++i) {
            if (
                candidates[nextCandidateIndex].activeKeysCount < candidates[i].activeKeysCount &&
                candidates[nextCandidateSuccessorIndex].activeKeysCount > candidates[i].activeKeysCount
            ) {
                nextCandidateSuccessorIndex = i;
            }
        }

        keysDistributed = Math.min(keysToDistribute / candidatesCount, candidates[nextCandidateIndex].activeKeysCount);

        // case when all candidates has same number of active keys count
        if (nextCandidateSuccessorIndex != nextCandidateIndex) {
            keysDistributed = Math.min(keysDistributed, candidates[nextCandidateSuccessorIndex].activeKeysCount);
        }
    }
}
