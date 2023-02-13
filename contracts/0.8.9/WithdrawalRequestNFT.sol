// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>, OpenZeppelin
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721Receiver.sol";
import {IERC721Metadata} from "@openzeppelin/contracts-v4.4/token/ERC721/extensions/IERC721Metadata.sol";
import {IERC165} from "@openzeppelin/contracts-v4.4/utils/introspection/IERC165.sol";

import {EnumerableSet} from "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {Address} from "@openzeppelin/contracts-v4.4/utils/Address.sol";
import {Strings} from "@openzeppelin/contracts-v4.4/utils/Strings.sol";

import {IWstETH, WithdrawalQueue} from "./WithdrawalQueue.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";
import {UnstructuredRefStorage} from "./lib/UnstructuredRefStorage.sol";

/// @title NFT implementation on top of {WithdrawalQueue}
/// NFT is minted on every request and burned on claim
///
/// @author psirex, folkyatina
contract WithdrawalRequestNFT is IERC721Metadata, WithdrawalQueue {
    using Address for address;
    using Strings for uint256;
    using EnumerableSet for EnumerableSet.UintSet;
    using UnstructuredRefStorage for bytes32;

    bytes32 internal constant TOKEN_APPROVALS_POSITION = keccak256("lido.WithdrawalRequestNFT.tokenApprovals");
    bytes32 internal constant OPERATOR_APPROVALS_POSITION = keccak256("lido.WithdrawalRequestNFT.operatorApprovals");
    bytes32 internal constant BASE_URI_POSITION = keccak256("lido.WithdrawalRequestNFT.baseUri");

    bytes32 public constant SET_BASE_URI_ROLE = keccak256("SET_BASE_URI_ROLE");

    // @notion simple wrapper for base URI string
    //  Solidity does not allow to store string in UnstructuredStorage
    struct BaseUri {
        string value;
    }

    event BaseURISet(string baseURI);

    error ApprovalToOwner();
    error ApproveToCaller();
    error NotOwnerOrApprovedForAll(address sender);
    error NotOwnerOrApproved(address sender);
    error TransferFromIncorrectOwner(address from, address realOwner);
    error TransferToZeroAddress();
    error TransferFromZeroAddress();
    error TransferToNonIERC721Receiver(address);
    error InvalidOwnerAddress(address);
    error StringTooLong(string str);
    error ZeroMetadata();

    // short strings for ERC721 name and symbol
    bytes32 private immutable NAME;
    bytes32 private immutable SYMBOL;

    /// @param _wstETH address of WstETH contract
    /// @param _name IERC721Metadata name string. Should be shorter than 32 bytes
    /// @param _symbol IERC721Metadata symbol string. Should be shorter than 32 bytes
    constructor(address _wstETH, string memory _name, string memory _symbol) WithdrawalQueue(IWstETH(_wstETH)) {
        if (bytes(_name).length == 0 || bytes(_symbol).length == 0) revert ZeroMetadata();
        NAME = _toBytes32(_name);
        SYMBOL = _toBytes32(_symbol);
    }

    /// @dev See {IERC165-supportsInterface}.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override (IERC165, AccessControlEnumerable)
        returns (bool)
    {
        return interfaceId == type(IERC721).interfaceId || interfaceId == type(IERC721Metadata).interfaceId
            || super.supportsInterface(interfaceId);
    }

    /// @dev Se_toBytes321Metadata-name}.
    function name() external view returns (string memory) {
        return _toString(NAME);
    }

    /// @dev Se_toBytes321Metadata-symbol}.
    function symbol() external view override returns (string memory) {
        return _toString(SYMBOL);
    }

    /// @dev See {IERC721Metadata-tokenURI}.
    function tokenURI(uint256 _requestId) public view virtual override returns (string memory) {
        if (!_existsAndNotClaimed(_requestId)) revert InvalidRequestId(_requestId);

        string memory baseURI = _getBaseUri().value;
        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, _requestId.toString())) : "";
    }

    /// @notice Base URI for computing {tokenURI}. If set, the resulting URI for each
    /// token will be the concatenation of the `baseURI` and the `_requestId`.
    function getBaseUri() external view returns (string memory) {
        return _getBaseUri().value;
    }

    /// @notice Sets the Base URI for computing {tokenURI}
    function setBaseUri(string calldata _baseUri) external onlyRole(SET_BASE_URI_ROLE) {
        _getBaseUri().value = _baseUri;
        emit BaseURISet(_baseUri);
    }

    /// @dev See {IERC721-balanceOf}.
    function balanceOf(address _owner) external view override returns (uint256) {
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
    function approve(address _to, uint256 _requestId) external override {
        address owner = ownerOf(_requestId);
        if (_to == owner) revert ApprovalToOwner();
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender)) revert NotOwnerOrApprovedForAll(msg.sender);

        _approve(_to, _requestId);
    }

    /// @dev See {IERC721-getApproved}.
    function getApproved(uint256 _requestId) external view override returns (address) {
        if (!_existsAndNotClaimed(_requestId)) revert InvalidRequestId(_requestId);

        return _getTokenApprovals()[_requestId];
    }

    /// @dev See {IERC721-setApprovalForAll}.
    function setApprovalForAll(address _operator, bool _approved) external override {
        _setApprovalForAll(msg.sender, _operator, _approved);
    }

    /// @dev See {IERC721-isApprovedForAll}.
    function isApprovedForAll(address _owner, address _operator) public view override returns (bool) {
        return _getOperatorApprovals()[_owner][_operator];
    }

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(address _from, address _to, uint256 _requestId) external override {
        safeTransferFrom(_from, _to, _requestId, "");
    }

    /// @dev See {IERC721-safeTransferFrom}.
    function safeTransferFrom(address _from, address _to, uint256 _requestId, bytes memory _data) public override {
        _transfer(_from, _to, _requestId);
        if (!_checkOnERC721Received(_from, _to, _requestId, _data)) {
            revert TransferToNonIERC721Receiver(_to);
        }

        emit Transfer(_from, _to, _requestId);
    }

    /// @dev See {IERC721-transferFrom}.
    function transferFrom(address _from, address _to, uint256 _requestId) external override {
        _transfer(_from, _to, _requestId);

        emit Transfer(_from, _to, _requestId);
    }

    /// @dev Transfers `_requestId` from `_from` to `_to`.
    ///  As opposed to {transferFrom}, this imposes no restrictions on msg.sender.
    ///
    /// Requirements:
    ///
    /// - `_to` cannot be the zero address.
    /// - `_requestId` request must not be claimed and be owned by `_from`.
    /// - `msg.sender` should be approved, or approved for all, or owner
    function _transfer(address _from, address _to, uint256 _requestId) internal {
        if (_to == address(0)) revert TransferToZeroAddress();
        if (_requestId == 0 || _requestId > getLastRequestId()) revert InvalidRequestId(_requestId);

        WithdrawalRequest storage request = _getQueue()[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed(_requestId);

        if (_from != request.owner) revert TransferFromIncorrectOwner(_from, request.owner);
        if (!_isApprovedOrOwner(msg.sender, _requestId, request)) revert NotOwnerOrApproved(msg.sender);

        delete _getTokenApprovals()[_requestId];
        request.owner = payable(_to);

        _getRequestsByOwner()[_to].add(_requestId);
        _getRequestsByOwner()[_from].remove(_requestId);
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

    /// @dev Returns whether `_spender` is allowed to manage `_requestId`.
    ///
    /// Requirements:
    ///
    /// - `_requestId` must exist (not checking).
    function _isApprovedOrOwner(address _spender, uint256 _requestId, WithdrawalRequest memory request)
        internal
        view
        returns (bool)
    {
        address owner = request.owner;
        return (_spender == owner || isApprovedForAll(owner, _spender) || _getTokenApprovals()[_requestId] == _spender);
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

    /// @dev Approve `_to` to operate on `_requestId`
    /// Emits a { Approval } event.
    function _approve(address _to, uint256 _requestId) internal {
        _getTokenApprovals()[_requestId] = _to;
        emit Approval(ownerOf(_requestId), _to, _requestId);
    }

    /// @dev Approve `operator` to operate on all of `owner` tokens
    /// Emits a { ApprovalForAll } event.
    function _setApprovalForAll(address _owner, address _operator, bool _approved) internal {
        if (_owner == _operator) revert ApproveToCaller();
        _getOperatorApprovals()[_owner][_operator] = _approved;
        emit ApprovalForAll(_owner, _operator, _approved);
    }

    /// @dev Decode a `bytes32 to string
    function _toString(bytes32 _sstr) internal pure returns (string memory) {
        uint256 len = _length(_sstr);
        // using `new string(len)` would work locally but is not memory safe.
        string memory str = new string(32);
        /// @solidity memory-safe-assembly
        assembly {
            mstore(str, len)
            mstore(add(str, 0x20), _sstr)
        }
        return str;
    }

    /// @dev encodes string `_str` in bytes32. Reverts if the string length > 31
    function _toBytes32(string memory _str) internal pure returns (bytes32) {
        bytes memory bstr = bytes(_str);
        if (bstr.length > 31) {
            revert StringTooLong(_str);
        }
        return bytes32(uint256(bytes32(bstr)) | bstr.length);
    }

    /// @dev Return the length of a string encoded in bytes32
    function _length(bytes32 _sstr) internal pure returns (uint256) {
        return uint256(_sstr) & 0xFF;
    }

    function _getTokenApprovals() internal pure returns (mapping(uint256 => address) storage) {
        return TOKEN_APPROVALS_POSITION.storageMapUint256Address();
    }

    function _getOperatorApprovals() internal pure returns (mapping(address => mapping(address => bool)) storage) {
        return OPERATOR_APPROVALS_POSITION.storageMapAddressMapAddressBool();
    }

    function _getBaseUri() internal pure returns (BaseUri storage baseUri) {
        bytes32 position = BASE_URI_POSITION;
        assembly {
            baseUri.slot := position
        }
    }
}
