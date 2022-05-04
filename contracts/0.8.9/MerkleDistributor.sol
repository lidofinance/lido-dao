//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./interfaces/ILido.sol";
import "./MerkleProof.sol";

contract MerkleDistributor {

    address public immutable token;
    bytes32 public merkleRoot;

    mapping(address => uint256) public claimed;

    constructor(address _token) {
        token = _token;
    }

    /**
     * set new merkle root
     */
    function setMerkleRoot(bytes32 _root) external {
        merkleRoot = _root;
    }

    /**
     * _amount shoud be cumulative
     */
    function claim(uint256 _amount, bytes32[] memory proof) external {
        //check merkleroot proof
        address operator =  msg.sender;
        bytes32 leaf = keccak256(abi.encodePacked( operator, _amount));
        require(MerkleProof.verify(proof, merkleRoot, leaf ), "Invalid proof");

        uint256 claimedAmount = claimed[operator];
        require(claimedAmount < _amount, "Nothing to claim");
        claimed[operator] = _amount;

        uint256 amount = _amount - claimedAmount;
        require(ILido(token).claim(operator, amount), "Transfer failed");

        //emit Claimed()
    }
}