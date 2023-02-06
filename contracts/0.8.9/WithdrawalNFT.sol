// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import {IERC721Metadata} from "@openzeppelin/contracts-v4.4/token/ERC721/extensions/IERC721Metadata.sol";

import {Strings} from "@openzeppelin/contracts-v4.4/utils/Strings.sol";
import {ERC165} from "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import {EnumerableSet} from "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";

import {IWstETH, WithdrawalQueue} from "./WithdrawalQueue.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

contract WithdrawalNFT is IERC721, ERC165, WithdrawalQueue {
    using Strings for uint256;
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant TOKEN_APPROVALS_POSITION = keccak256("lido.WithdrawalNFT.tokenApprovals");
    bytes32 public constant OPERATOR_APPROVALS = keccak256("lido.WithdrawalNFT.operatorApprovals");

    /// @param _wstETH address of WstETH contract
    constructor(address _wstETH) WithdrawalQueue(IWstETH(_wstETH)) {}

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlEnumerable, ERC165, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC721).interfaceId ||
            interfaceId == type(IERC721Metadata).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @dev See {IERC721-balanceOf}.
    function balanceOf(address _owner) public view returns (uint256) {
        if (_owner == address(0)) revert InvalidOwnerAddress(_owner);
        return _getRequestByOwner()[_owner].length();
    }

    /// @dev See {IERC721-ownerOf}.
    function ownerOf(uint256 _tokenId) public view returns (address) {
        if (_tokenId == 0 || _tokenId > getLastRequestId()) revert InvalidRequestId(_tokenId);
        return _getQueue()[_tokenId].owner;
    }

    /// @dev See {IERC721Metadata-name}.
    function name() public view returns (string memory) {
        revert("Unimplemented");
    }

    /// @dev See {IERC721Metadata-symbol}.
    function symbol() public view returns (string memory) {
        revert("Unimplemented");
    }

    /// @dev See {IERC721Metadata-tokenURI}.

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_exists(tokenId), "ERC721Metadata: URI query for nonexistent token");

        string memory baseURI = _baseURI();
        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, tokenId.toString())) : "";
    }

    /// @dev Base URI for computing {tokenURI}. If set, the resulting URI for each
    /// token will be the concatenation of the `baseURI` and the `tokenId`. Empty
    /// by default, can be overriden in child contracts.

    function _baseURI() internal view returns (string memory) {
        return "";
    }

    /// @dev See {IERC721-approve}.
    function approve(address to, uint256 tokenId) public {
        address owner = ownerOf(tokenId);
        require(to != owner, "ERC721: approval to current owner");

        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender),
            "ERC721: approve caller is not owner nor approved for all"
        );

        _approve(to, tokenId);
    }

    /// @dev See {IERC721-getApproved}.
    function getApproved(uint256 tokenId) public view returns (address) {
        require(_exists(tokenId), "ERC721: approved query for nonexistent token");

        return _getTokenApprovals()[tokenId];
    }

    /// @dev See {IERC721-setApprovalForAll}.
    function setApprovalForAll(address operator, bool approved) public {
        _setApprovalForAll(_msgSender(), operator, approved);
    }

    /// @dev See {IERC721-isApprovedForAll}.
    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _getOperatorApprovals()[owner][operator];
    }

    /// @dev See {IERC721-transferFrom}.
    function transferFrom(
        address, // from
        address, // to
        uint256 // tokenId
    ) public virtual override {
        revert("Unimplemented");
    }

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(
        address, // from
        address, // to
        uint256 // tokenId
    ) public virtual override {
        revert("Unimplemented");
    }

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(
        address, // from
        address, // to
        uint256, // tokenId
        bytes memory // _data
    ) public virtual override {
        revert("Unimplemented");
    }

    //
    // Internal getters and setters
    //

    /// @dev Returns whether `tokenId` exists.
    ///
    /// Tokens can be managed by their owner or approved accounts via {approve} or {setApprovalForAll}.
    function _exists(uint256 _tokenId) internal view virtual returns (bool) {
        return _tokenId != 0 && _tokenId < getLastRequestId();
    }

    /// @dev Approve `to` to operate on `tokenId`
    /// Emits a {Approval} event.
    function _approve(address to, uint256 tokenId) internal virtual {
        _getTokenApprovals()[tokenId] = to;
        emit Approval(ownerOf(tokenId), to, tokenId);
    }

    /// @dev Approve `operator` to operate on all of `owner` tokens
    /// Emits a {ApprovalForAll} event.
    function _setApprovalForAll(
        address owner,
        address operator,
        bool approved
    ) internal virtual {
        require(owner != operator, "ERC721: approve to caller");
        _getOperatorApprovals()[owner][operator] = approved;
        emit ApprovalForAll(owner, operator, approved);
    }

    function _getTokenApprovals() internal pure returns (mapping(uint256 => address) storage tokenApprovals) {
        bytes32 position = TOKEN_APPROVALS_POSITION;
        assembly {
            tokenApprovals.slot := position
        }
    }

    function _getOperatorApprovals()
        internal
        pure
        returns (mapping(address => mapping(address => bool)) storage operatorApprovals)
    {
        bytes32 position = TOKEN_APPROVALS_POSITION;
        assembly {
            operatorApprovals.slot := position
        }
    }
}
