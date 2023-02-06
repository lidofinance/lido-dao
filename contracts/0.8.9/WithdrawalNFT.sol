// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>, OpenZeppelin
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721Receiver.sol";
import {IERC165} from "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import {IERC721Metadata} from "@openzeppelin/contracts-v4.4/token/ERC721/extensions/IERC721Metadata.sol";

import {Strings} from "@openzeppelin/contracts-v4.4/utils/Strings.sol";
import {ERC165} from "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import {EnumerableSet} from "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {Address} from "@openzeppelin/contracts-v4.4/utils/Address.sol";

import {IWstETH, WithdrawalQueue} from "./WithdrawalQueue.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

/// @title NFT implementation around {WithdrawalRequest}
/// @author psirex, folkyatina
contract WithdrawalNFT is IERC721, ERC165, WithdrawalQueue {
    using Strings for uint256;
    using Address for address;
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant TOKEN_APPROVALS_POSITION = keccak256("lido.WithdrawalNFT.tokenApprovals");
    bytes32 public constant OPERATOR_APPROVALS = keccak256("lido.WithdrawalNFT.operatorApprovals");

    /// @param _wstETH address of WstETH contract
    constructor(address _wstETH) WithdrawalQueue(IWstETH(_wstETH)) {}

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override (AccessControlEnumerable, ERC165, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC721).interfaceId 
            || interfaceId == type(IERC721Metadata).interfaceId
            || super.supportsInterface(interfaceId);
    }

    /// @dev See {IERC721-balanceOf}.
    function balanceOf(address _owner) public view returns (uint256) {
        if (_owner == address(0)) revert InvalidOwnerAddress(_owner);
        return _getRequestsByOwner()[_owner].length();
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
        require(_existsAndNotClaimed(tokenId), "ERC721Metadata: URI query for nonexistent or claimed token");

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
        require(_existsAndNotClaimed(tokenId), "ERC721: approved query for nonexistent or claimed token");

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

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(address from, address to, uint256 tokenId) public override {
        safeTransferFrom(from, to, tokenId, "");
    }

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public override {
        require(_isApprovedOrOwner(msg.sender, tokenId), "ERC721: caller is not token owner or approved");
        _safeTransfer(from, to, tokenId, data);
    }

    /// @dev See {IERC721-transferFrom}.
    function transferFrom(address from, address to, uint256 tokenId) public override {
         require(_isApprovedOrOwner(msg.sender, tokenId), "ERC721: caller is not token owner or approved");
        _transfer(from, to, tokenId);

        emit Transfer(from, to, tokenId);
    }

    /// @dev Transfers `tokenId` from `from` to `to`.
    ///  As opposed to {transferFrom}, this imposes no restrictions on msg.sender.
    ///
    /// Requirements:
    ///
    /// - `from` cannot be the zero address.
    /// - `to` cannot be the zero address.
    /// - `tokenId` token must be owned by `from`.
    ///
    /// Emits a {Transfer} event.
    function _transfer(address from, address to, uint256 tokenId) internal {
        require(from != address(0), "ERC721: transfer from zero address");
        require(to != address(0), "ERC721: transfer to the zero address");
        require(_existsAndNotClaimed(tokenId), "ERC721: transfer nonexistent or claimed token");

        WithdrawalRequest storage request = _getQueue()[tokenId];

        if (request.claimed) revert RequestAlreadyClaimed(tokenId);

        delete _getTokenApprovals()[tokenId];
        request.owner = payable(to);

        _getRequestsByOwner()[to].add(tokenId);
        _getRequestsByOwner()[from].remove(tokenId);
    }

    /// @dev Safely transfers `tokenId` token from `from` to `to`, checking first that contract recipients
    ///  are aware of the ERC721 protocol to prevent tokens from being forever locked.
    ///  `data` is additional data, it has no specified format and it is sent in call to `to`.
    ///
    /// Requirements:
    ///
    ///  - `from` cannot be the zero address.
    ///  - `to` cannot be the zero address.
    ///  - `tokenId` token must exist and be owned by `from`.
    ///  - If `to` refers to a smart contract, it must implement {IERC721Receiver-onERC721Received}, which is called upon a safe transfer.
    ///
    ///  Emits a {Transfer} event.
    function _safeTransfer(address from, address to, uint256 tokenId, bytes memory data) internal {
        _transfer(from, to, tokenId);
        require(_checkOnERC721Received(from, to, tokenId, data), "ERC721: transfer to non ERC721Receiver implementer");

        emit Transfer(from, to, tokenId);
    }

    /// @dev Internal function to invoke {IERC721Receiver-onERC721Received} on a target address.
    /// The call is not executed if the target address is not a contract.
    ///
    /// @param from address representing the previous owner of the given token ID
    /// @param to target address that will receive the tokens
    /// @param tokenId uint256 ID of the token to be transferred
    /// @param data bytes optional data to send along with the call
    /// @return bool whether the call correctly returned the expected magic value
    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data)
        private
        returns (bool)
    {
        if (to.isContract()) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 retval) {
                return retval == IERC721Receiver.onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert("ERC721: transfer to non ERC721Receiver implementer");
                } else {
                    /// @solidity memory-safe-assembly
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        } else {
            return true;
        }
    }

    /// @dev Returns whether `spender` is allowed to manage `tokenId`.
    ///
    /// Requirements:
    ///
    /// - `tokenId` must exist.
    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = ownerOf(tokenId);
        return (spender == owner || isApprovedForAll(owner, spender) || getApproved(tokenId) == spender);
    }

    //
    // Internal getters and setters
    //

    /// @dev Returns whether `_requestId` exists and not claimed.
    function _existsAndNotClaimed(uint256 _requestId) internal view returns (bool) {
        return _requestId > 0 && _requestId <= getLastRequestId() && !_getQueue()[_requestId].claimed;
    }

    /// @dev Approve `to` to operate on `tokenId`
    /// Emits a {Approval} event.
    function _approve(address to, uint256 tokenId) internal virtual {
        _getTokenApprovals()[tokenId] = to;
        emit Approval(ownerOf(tokenId), to, tokenId);
    }

    /// @dev Approve `operator` to operate on all of `owner` tokens
    /// Emits a {ApprovalForAll} event.
    function _setApprovalForAll(address owner, address operator, bool approved) internal virtual {
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
