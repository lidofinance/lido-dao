// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./Ownable.sol";

/**
  * @title Thin forwarding proxy for token which represents a liquid
  * version of staked ETH 2.0 native token.
  *
  * TODO: add docs here
  */
contract TokenForwarder is IERC20, Ownable {
    IERC20 private tokenImpl;

    modifier onlyTokenImpl() {
        require(address(tokenImpl) == msg.sender);
        _;
    }

    /**
     * @dev Sets the owner and tokenImpl.
     */
    constructor (address _owner, IERC20 _tokenImpl)
        public
        Ownable(_owner)
    {
        _setTokenImpl(_tokenImpl);
    }

    function getTokenImpl() public view returns (address) {
        return tokenImpl;
    }

    /**
    * @dev Sets token implementation
    * @param tokenImpl_ token implementation contract to set
    */
    function setTokenImpl(IERC20 tokenImpl_) public onlyOwner {
        _setTokenImpl(tokenImpl_);
    }

    /**
    * @dev Sets token implementation
    * @param tokenImpl_ token implementation contract to set
    */
    function _setTokenImpl(IERC20 tokenImpl_) internal {
        require(Address.isContract(address(tokenImpl_)), "NOT_A_CONTRACT");
        tokenImpl = tokenImpl_;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public pure returns (string) {
        return "Liquid staked Ether 2.0";
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public pure returns (string) {
        return "stETH";
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     */
    function decimals() public pure returns (uint8) {
        return 18;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view override returns (uint256) {
        return tokenImpl.totalSupply();
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view override returns (uint256) {
        return tokenImpl.balanceOf(account);
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        bool success = tokenImpl.transfer(recipient, amount);
        if (success) {
            _emitTransfer(msg.sender, recipient, amount);
        }
        return success;

    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return tokenImpl.allowance(owner, spender);
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        bool success = tokenImpl.approve(spender, amount);
        if (success) {
            _emitApproval(msg.sender, spender, amount);
        }
        return success;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * Requirements:
     *
     * - `sender` and `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     * - the caller must have allowance for ``sender``'s tokens of at least
     * `amount`.
     */
    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        bool success = tokenImpl.transferFrom(sender, recipient, amount);
        if (success) {
            _emitTransfer(sender, recipient, amount);
            uint256 newApprovalAmount = tokenImpl.allowance(sender, msg.sender);
            _emitApproval(msg.sender, spender, newApprovalAmount);
        }
        return success;
    }

    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        bool success = tokenImpl.increaseAllowance(spender, addedValue);
        if (success) {
            uint256 newApprovalAmount = tokenImpl.allowance(msg.sender, spender);
            _emitApproval(msg.sender, spender, newApprovalAmount);
        }
        return success;
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        bool success = tokenImpl.decreaseAllowance(spender, subtractedValue);
        if (success) {
            uint256 newApprovalAmount = tokenImpl.allowance(msg.sender, spender);
            _emitApproval(msg.sender, spender, newApprovalAmount);
        }
        return success;
    }

    /**
     * @dev TODO: add motivation here why token impl should be ablt to call this
     * hook in some cases.
     */
    function emitTransfer(address sender, address recipient, uint256 amount) public onlyTokenImpl {
        _emitTransfer(sender, recipient, amount);
    }
    
    /**
     * @dev TODO: add motivation here why token impl should be ablt to call this
     * hook in some cases.
     */
    function emitApproval(address owner, address spender, uint256 amount) public onlyTokenImpl {
        _emitApproval(owner, spender, amount);
    }

    function _emitTransfer(address sender, address recipient, uint256 amount) internal {
        emit Transfer(sender, recipient, amount);
    }
    
    function _emitApproval(address owner, address spender, uint256 amount) internal {
        emit Approval(owner, spender, amount);
    }
}