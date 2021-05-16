pragma solidity 0.4.24;

library Merkle {
    /**
     * Taken from Matic implementation of merkle tree:
     * https://github.com/maticnetwork/pos-portal/blob/d06271188412a91ab9e4bdea4bbbfeb6cb9d7669/contracts/lib/Merkle.sol
     * @notice Verifies the membership of `leaf` at position `index` within merkle tree with root `rootHash`.
     */
    function checkMembership(
        bytes32 leaf,
        uint256 index,
        bytes32 rootHash,
        bytes memory proof
    ) internal pure returns (bool) {
        require(proof.length % 32 == 0, "Invalid proof length");
        uint256 proofHeight = proof.length / 32;
        // Proof of size n means, height of the tree is n+1.
        // In a tree of height n+1, max #leafs possible is 2 ^ n
        require(index < 2 ** proofHeight, "Leaf index is too big");

        bytes32 proofElement;
        bytes32 computedHash = leaf;
        for (uint256 i = 32; i <= proof.length; i += 32) {
            assembly {
                proofElement := mload(add(proof, i))
            }

            if (index % 2 == 0) {
                computedHash = keccak256(
                    abi.encodePacked(computedHash, proofElement)
                );
            } else {
                computedHash = keccak256(
                    abi.encodePacked(proofElement, computedHash)
                );
            }

            index = index / 2;
        }
        return computedHash == rootHash;
    }

    /**
     * @notice Calculates the root hash of a merkle tree made up of the provided set of leaves.
     */
    function calcRootHash(bytes32[] leafHashes) internal returns (bytes32 rootHash) {
        // TODO: replace pseudocode
        uint treeDepth = 4; // ceil(log2(leafHashes.length));
        uint256 numLeaves = 1 << treeDepth;
        bytes32[] memory hashes = new bytes32[](numLeaves);

        // Populate leaf values
        for (uint256 i = 0; i < leafHashes.length; i++){
            hashes[i] = leafHashes[i];
        }

        // Repeatedly hash until we reach the top of the tree
        for (uint256 layer = 0; layer < treeDepth; layer++){
            for (uint256 i = 0; i < (numLeaves >> layer); i+=2*(layer + 1)) {
                hashes[i] = keccak256(abi.encodePacked(hashes[i], hashes[i+layer+1]));
            }
        }

        // Root hash will be placed in position 0
        rootHash = hashes[0];
    }
}