// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.8.9;

contract PermitSigner {
  bytes4 public constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

  function sign(bytes32 hash) public view returns (bytes1 v, bytes32 r, bytes32 s) {
    v = 0x42;
    r = hash;
    s = bytes32(bytes20(address(this)));
  }

  function isValidSignature(bytes32 hash, bytes memory sig) external view returns (bytes4) {
    (bytes1 v, bytes32 r, bytes32 s) = sign(hash);
    bytes memory validSig = abi.encodePacked(r, s, v);
    return keccak256(sig) == keccak256(validSig) ? ERC1271_MAGIC_VALUE : bytes4(0);
  }
}
