// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "@aragon/os/contracts/common/UnstructuredStorage.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "./lib/Pausable.sol"; 

/**
 * @title Interest bearing ERC20-compatible token for Lido Liquid Stacking protocol.
 *
 * This contract is abstract. To make the contract deployable override the
 * `_getTotalPooledEther` function. `Lido.sol` contract inherits StETH and defines
 * the `_getTotalPooledEther` function along with `_stop` and `_resume` from the
 * `Pausable`.
 *
 * StETH balances are dynamic and represent the holder's share in the total amount
 * of Ether controlled by the protocol. Account shares aren't normalized, so the
 * contract also stores the sum of all shares to calculate accounts token balance
 * which equals:
 * `shares[account]`*`_getTotalPooledEther()`/`_getTotalShares()`
 *
 * For example, assume we have:
 *   _getTotalPooledEther() -> 10 ETH
 *   shareOf(user1) -> 100
 *   shareOf(user2) -> 400
 *
 * Therefore:
 *   balanceOf(user1) -> 2 tokens which corresponds 2 ETH
 *   balanceOf(user2) -> 8 tokens which corresponds 8 ETH
 *
 * Since balances of all token holders change when the amount of total pooled Ether
 * changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
 * events upon explicit transfer between holders. In contrast, when total amount of 
 * pooled Ether increases, no `Transfer` events are generated: doing so would require
 * emitting an event for each token holder and thus running an unbounded loop.
 *
 * The token inherits `Pausable` and use `whenNotStopped` modifier for methods which
 * changes `shares` or `allowances`. `_stop` and `_resume` function is overriden in
 * `Lido.sol` and might be called by account with `PAUSE_ROLE` assigned by the DAO.
 * Useful for emergency scenarios for freezing all token transfers and approvals in
 * case of protocol bug.
 */
contract StETH is IERC20, Pausable {
    using SafeMath for uint256;
    using UnstructuredStorage for bytes32;

    /**
     * StETH balances are dynamic and are calculated based on the accounts' shares
     * and the total amount of Ether controlled by the protocol. Account shares aren't
     * normalized, so the contract also stores the sum of all shares to calculate
     * accounts token balance which equals:
     * `shares[account]`*`_getTotalPooledEther()`/`_getTotalShares()`
    */
    mapping (address => uint256) private shares;
    mapping (address => mapping (address => uint256)) private allowances;

    /**
     * Storage position which used for holding the total amount of shares in existence.
     * The Lido protocol build on top of aragon and use unstructured storage.
     * https://blog.8bitzen.com/posts/20-02-2020-understanding-how-solidity-upgradeable-unstructured-proxies-work
     */
    bytes32 internal constant TOTAL_SHARES_VALUE_POSITION = keccak256("lido.Lido.totalShares");

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
     * @dev Returns the amount of tokens in existence.
     * @notice Always equals `_getTotalPooledEther()`. Because token amount 
     * pegged to the total amount of Ether controlled by the protocol.
     */
    function totalSupply() public view returns (uint256) {
        return _getTotalPooledEther();
    }

    /**
     * @notice Returns the entire amount of Ether controlled by the protocol.
     * @dev The summary of all the balances in the protocol, equals to the 
     * total supply of stETH.
     */
    function getTotalPooledEther() public view returns (uint256) {
        return _getTotalPooledEther();
    }

    /**
     * @dev Returns the amount of tokens owned by `account`.
     * @notice Balances are dynamic and equal the account's share
     * in the amount of the total Ether controlled by the protocol.
     * See {getShareOf}.
     */
    function balanceOf(address account) public view returns (uint256) {
        return getPooledEthByShares(_getSharesOf(account));
    }

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     * Emits a {Transfer} event.
     *
     * Requirements:
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     * - the contract must not be paused.
     *
     * @notice the `amount` in parameters is amount of token, not shares.
     */
    function transfer(address recipient, uint256 amount) public returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) public view returns (uint256) {
        return allowances[owner][spender];
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     * Emits an {Approval} event.
     *
     * Requirements:
     * - `spender` cannot be the zero address.
     * - the contract must not be paused.
     *
     * @notice the `amount` in parameters is amount of token, not shares.
     */
    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /**
     * @dev Moves `amount` tokens from `sender` to `recipient` using the
     * allowance mechanism. `amount` is then deducted from the caller's
     * allowance.
     * Returns a boolean value indicating whether the operation succeeded.
     * Emits a {Transfer} event.
     * Emits an {Approval} event indicating the updated allowance. 
     *
     * Requirements:
     * - `sender` and `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     * - the caller must have allowance for ``sender``'s tokens of at least
     * `amount`.
     * - the contract must not be paused.
     *
     * @notice the `amount` in parameters is amount of token, not shares.
     */
    function transferFrom(address sender, address recipient, uint256 amount) public returns (bool) {
        uint256 currentAllowance = allowances[sender][msg.sender];
        require(currentAllowance >= amount, "TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE");
        
        _transfer(sender, recipient, amount);
        _approve(sender, msg.sender, currentAllowance.sub(amount));
        return true;
    }

    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in:
     * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol#L42
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     * - `spender` cannot be the zero address.
     * - the contract must not be paused.
     */
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        _approve(msg.sender, spender, allowances[msg.sender][spender].add(addedValue));
        return true;
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in:
     * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol#L42
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     * - the contract must not be paused.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        uint256 currentAllowance = allowances[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "DECREASED_ALLOWANCE_BELOW_ZERO");
        _approve(msg.sender, spender, currentAllowance.sub(subtractedValue));
        return true;
    }

    /**
     * @dev Returns the total amount of shares in existence.
     * @notice The sum of the accounts' shares can be an arbitrary number, 
     * therefore, to calculate the balance of tokens, it is necessary to store 
     * the current amount of all shares.
     */
    function getTotalShares() public view returns (uint256) {
        return _getTotalShares();
    }

    /**
     * @dev Returns the amount of shares owned by `account`.
     */
    function getSharesOf(address account) public view returns (uint256) {
        return _getSharesOf(account);
    }

    /**
     * @dev Returns the amount of shares that corresponds to `_ethAmount`.
     */
    function getSharesByPooledEth(uint256 _ethAmount) public view returns (uint256) {
        uint256 totalPooledEther = _getTotalPooledEther();
        if (totalPooledEther == 0) {
            return 0;
        } else {
            return _ethAmount
                .mul(_getTotalShares())
                .div(totalPooledEther);
        }
    }

    /**
     * @dev Returns the amount of ether that corresponds to `_sharesAmount`.
     */
    function getPooledEthByShares(uint256 _sharesAmount) public view returns (uint256) {
        uint256 totalShares = _getTotalShares();
        if (totalShares == 0) {
            return 0;
        } else {
            return _sharesAmount
                .mul(_getTotalPooledEther())
                .div(totalShares);
        }
    }

    /**
     * @dev Returns the total amount of Ether in wei controlled by the protocol
     * which is the required for accounts' balance calculations.
     *
     * @notice This function is required to be overridden in `Lido`.
     */
    function _getTotalPooledEther() internal view returns (uint256);

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     * This is internal function is equivalent to {transfer} that convert token
     * value to shares, perform {_transferShares} call and emits Transfer event
     * afterall.
     *
     * Emits a {Transfer} event.
     */
    function _transfer(address sender, address recipient, uint256 amount) internal {
        uint256 _sharesToTransfer = getSharesByPooledEth(amount);
        _transferShares(sender, recipient, _sharesToTransfer);
        emit Transfer(sender, recipient, amount);
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the `owner` s tokens.
     *
     * This internal function is equivalent to `approve`.
     * Emits an {Approval} event.
     *
     * Requirements:
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     * - the contract must not be paused.
     */
    function _approve(address owner, address spender, uint256 amount) internal whenNotStopped {
        require(owner != address(0), "APPROVE_FROM_ZERO_ADDRESS");
        require(spender != address(0), "APPROVE_TO_ZERO_ADDRESS");

        allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /**
     * @dev Returns the total amount of shares in existence.
     * The Lido protocol build on top of aragon and use unstructured storage
     * for upgrade purposes.
     * 
     * https://blog.8bitzen.com/posts/20-02-2020-understanding-how-solidity-upgradeable-unstructured-proxies-work
     */
    function _getTotalShares() internal view returns (uint256) {
        return TOTAL_SHARES_VALUE_POSITION.getStorageUint256();
    }

    /**
     * @dev Returns the amount of shares owned by `account`.
     */
    function _getSharesOf(address account) internal view returns (uint256) {
        return shares[account];
    }

    /**
     * @dev Moves shares `sharesAmount` from `sender` to `recipient`.
     *
     * This is internal function which used by {_transfer} function.
     *
     * Requirements:
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must have a number of shares of at least `sharesAmount`.
     * - the contract must not be paused.
     */
    function _transferShares(address sender, address recipient, uint256 sharesAmount) internal whenNotStopped {
        require(sender != address(0), "TRANSFER_FROM_THE_ZERO_ADDRESS");
        require(recipient != address(0), "TRANSFER_TO_THE_ZERO_ADDRESS");
        
        uint256 currentSenderShares = shares[sender];        
        require(sharesAmount <= currentSenderShares, "TRANSFER_AMOUNT_EXCEEDS_BALANCE");

        shares[sender] = currentSenderShares.sub(sharesAmount);
        shares[recipient] = shares[recipient].add(sharesAmount);
    }

    /** @dev Creates `sharesAmount` shares and assigns them to `account`, increases
     * the total amount of shares.
     *
     * Requirements:
     * - `to` cannot be the zero address.
     * - the contract must not be paused.
     */
    function _mintShares(address to, uint256 sharesAmount) internal whenNotStopped returns (uint256 newTotalShares) {
        require(to != address(0), "MINT_TO_THE_ZERO_ADDRESS");

        newTotalShares = _getTotalShares().add(sharesAmount);
        TOTAL_SHARES_VALUE_POSITION.setStorageUint256(newTotalShares);

        shares[to] = shares[to].add(sharesAmount);
    }

    /**
     * @dev Destroys `sharesAmount` shares from `account`, decreases the
     * the total amount of shares.
     *
     * Requirements:
     * - `account` cannot be the zero address.
     * - `account` must have at least `sharesAmount` tokens.
     * - the contract must not be paused.
     */
    function _burnShares(address account, uint256 sharesAmount) internal whenNotStopped returns (uint256 newTotalShares) {
        require(account != address(0), "BURN_FROM_THE_ZERO_ADDRESS");
        
        uint256 accountShares = shares[account];
        require(sharesAmount <= accountShares, "BURN_AMOUNT_EXCEEDS_BALANCE");

        newTotalShares = _getTotalShares().sub(sharesAmount);
        TOTAL_SHARES_VALUE_POSITION.setStorageUint256(newTotalShares);

        shares[account] = accountShares.sub(sharesAmount);
    }
}
