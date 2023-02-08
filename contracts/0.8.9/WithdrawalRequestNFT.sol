// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>, OpenZeppelin
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721Receiver.sol";
import {IERC165} from "@openzeppelin/contracts-v4.4/utils/introspection/IERC165.sol";

import {EnumerableSet} from "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {Address} from "@openzeppelin/contracts-v4.4/utils/Address.sol";

import {IWstETH, WithdrawalQueue} from "./WithdrawalQueue.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";
import {UnstructuredRefStorage} from "./lib/UnstructuredRefStorage.sol";

/// @title NFT implementation on top of {WithdrawalQueue}
/// NFT is minted on every request and burned on claim
///
/// @author psirex, folkyatina
contract WithdrawalRequestNFT is IERC721, WithdrawalQueue {
    using Address for address;
    using EnumerableSet for EnumerableSet.UintSet;
    using UnstructuredRefStorage for bytes32;

    bytes32 internal constant TOKEN_APPROVALS_POSITION = keccak256("lido.WithdrawalNFT.tokenApprovals");
    bytes32 internal constant OPERATOR_APPROVALS = keccak256("lido.WithdrawalNFT.operatorApprovals");

    error ApprovalToOwner();
    error ApproveToCaller();
    error NotOwnerOrApprovedForAll(address sender);
    error NotOwnerOrApproved(address sender);
    error TransferFromIncorrectOwner(address from, address realOwner);
    error TransferToZeroAddress();
    error TransferFromZeroAddress();
    error TransferToNonIERC721Receiver(address);

    /// @param _wstETH address of WstETH contract
    constructor(address _wstETH) WithdrawalQueue(IWstETH(_wstETH)) {}

    /// See {IERC165-supportsInterface}.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override (IERC165, AccessControlEnumerable)
        returns (bool)
    {
        return interfaceId == type(IERC721).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @dev See {IERC721-balanceOf}.
    function balanceOf(address _owner) public view override returns (uint256) {
        if (_owner == address(0)) revert InvalidOwnerAddress(_owner);
        return _getRequestsByOwner()[_owner].length();
    }

    /// @dev See {IERC721-ownerOf}.
    function ownerOf(uint256 _requestId) public view override returns (address) {
        if (_requestId == 0 || _requestId > getLastRequestId()) revert InvalidRequestId(_requestId);

        WithdrawalRequest memory request = _getQueue()[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed(_requestId);

        return request.owner;
    }

    /// @dev See {IERC721-approve}.
    function approve(address _to, uint256 _requestId) public override {
        address owner = ownerOf(_requestId);
        if (_to == owner) revert ApprovalToOwner();
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender)) revert NotOwnerOrApprovedForAll(msg.sender);

        _approve(_to, _requestId);
    }

    /// @dev See {IERC721-getApproved}.
    function getApproved(uint256 _requestId) public view override returns (address) {
        if (!_existsAndNotClaimed(_requestId)) revert InvalidRequestId(_requestId);

        return _getTokenApprovals()[_requestId];
    }

    /// @dev See {IERC721-setApprovalForAll}.
    function setApprovalForAll(address _operator, bool _approved) public override {
        _setApprovalForAll(msg.sender, _operator, _approved);
    }

    /// @dev See {IERC721-isApprovedForAll}.
    function isApprovedForAll(address _owner, address _operator) public view override returns (bool) {
        return _getOperatorApprovals()[_owner][_operator];
    }

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(address _from, address _to, uint256 _requestId) public override {
        safeTransferFrom(_from, _to, _requestId, "");
    }

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(address _from, address _to, uint256 _requestId, bytes memory _data) public override {
        if (!_isApprovedOrOwner(msg.sender, _requestId)) revert NotOwnerOrApproved(msg.sender);
        _safeTransfer(_from, _to, _requestId, _data);
    }

    /// @dev See {IERC721-transferFrom}.
    function transferFrom(address _from, address _to, uint256 _requestId) public override {
        if (!_isApprovedOrOwner(msg.sender, _requestId)) revert NotOwnerOrApproved(msg.sender);
        _transfer(_from, _to, _requestId);

        emit Transfer(_from, _to, _requestId);
    }

    /// @dev Transfers `tokenId` from `from` to `to`.
    ///  As opposed to {transferFrom}, this imposes no restrictions on msg.sender.
    ///
    /// Requirements:
    ///
    /// - `from` cannot be the zero address.
    /// - `to` cannot be the zero address.
    /// - `tokenId` token must be owned by `from`.
    function _transfer(address _from, address _to, uint256 _requestId) internal {
        if (_from == address(0)) revert TransferFromZeroAddress();
        if (_to == address(0)) revert TransferToZeroAddress();
        if (_requestId == 0 || _requestId > getLastRequestId()) revert InvalidRequestId(_requestId);

        WithdrawalRequest storage request = _getQueue()[_requestId];

        if (_from != request.owner) revert TransferFromIncorrectOwner(_from, request.owner);
        if (request.claimed) revert RequestAlreadyClaimed(_requestId);

        delete _getTokenApprovals()[_requestId];
        request.owner = payable(_to);

        _getRequestsByOwner()[_to].add(_requestId);
        _getRequestsByOwner()[_from].remove(_requestId);
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
    function _safeTransfer(address _from, address _to, uint256 _requestId, bytes memory _data) internal {
        _transfer(_from, _to, _requestId);
        if (!_checkOnERC721Received(_from, _to, _requestId, _data)) {
            revert TransferToNonIERC721Receiver(_to);
        }

        emit Transfer(_from, _to, _requestId);
    }

    /// @dev Internal function to invoke {IERC721Receiver-onERC721Received} on a target address.
    /// The call is not executed if the target address is not a contract.
    ///
    /// @param _from address representing the previous owner of the given token ID
    /// @param _to target address that will receive the tokens
    /// @param _requestId uint256 ID of the token to be transferred
    /// @param _data bytes optional data to send along with the call
    /// @return bool whether the call correctly returned the expected magic value
    function _checkOnERC721Received(address _from, address _to, uint256 _requestId, bytes memory _data)
        private
        returns (bool)
    {
        if (_to.isContract()) {
            try IERC721Receiver(_to).onERC721Received(msg.sender, _from, _requestId, _data) returns (bytes4 retval) {
                return retval == IERC721Receiver.onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert TransferToNonIERC721Receiver(_to);
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
    function _isApprovedOrOwner(address _spender, uint256 _requestId) internal view returns (bool) {
        address owner = ownerOf(_requestId);
        return (_spender == owner || isApprovedForAll(owner, _spender) || getApproved(_requestId) == _spender);
    }

    //
    // Internal getters and setters
    //

    /// @dev a little crutch to emit { Transfer } on request and on claim like ERC721 states
    function _emitTransfer(address _from, address _to, uint256 _requestId) internal override {
        emit Transfer(_from, _to, _requestId);
    }

    /// @dev Returns whether `_requestId` exists and not claimed.
    function _existsAndNotClaimed(uint256 _requestId) internal view returns (bool) {
        return _requestId > 0 && _requestId <= getLastRequestId() && !_getQueue()[_requestId].claimed;
    }

    /// @dev Approve `to` to operate on `tokenId`
    /// Emits a {Approval} event.
    function _approve(address _to, uint256 _requestId) internal virtual {
        _getTokenApprovals()[_requestId] = _to;
        emit Approval(ownerOf(_requestId), _to, _requestId);
    }

    /// @dev Approve `operator` to operate on all of `owner` tokens
    /// Emits a {ApprovalForAll} event.
    function _setApprovalForAll(address _owner, address _operator, bool _approved) internal virtual {
        if (_owner == _operator) revert ApproveToCaller();
        _getOperatorApprovals()[_owner][_operator] = _approved;
        emit ApprovalForAll(_owner, _operator, _approved);
    }

    function _getTokenApprovals() internal pure returns (mapping(uint256 => address) storage) {
        return TOKEN_APPROVALS_POSITION.storageMapUint256Address();
    }

    function _getOperatorApprovals() internal pure returns (mapping(address => mapping(address => bool)) storage) {
        return OPERATOR_APPROVALS.storageMapAddressMapAddressBool();
    }
}
