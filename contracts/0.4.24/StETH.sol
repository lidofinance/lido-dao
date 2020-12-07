// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "@aragon/os/contracts/common/UnstructuredStorage.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "./lib/Pausable.sol";

/**
 * @title Interest-bearing ERC20-like token for Lido Liquid Stacking protocol.
 *
 * This contract is abstract. To make the contract deployable override the
 * `_getTotalPooledEther` function. `Lido.sol` contract inherits StETH and defines
 * the `_getTotalPooledEther` function.
 *
 * StETH balances are dynamic and represent the holder's share in the total amount
 * of Ether controlled by the protocol. Account shares aren't normalized, so the
 * contract also stores the sum of all shares to calculate each account's token balance
 * which equals to:
 *
 *   shares[account] * _getTotalPooledEther() / _getTotalShares()
 *
 * For example, assume that we have:
 *
 *   _getTotalPooledEther() -> 10 ETH
 *   sharesOf(user1) -> 100
 *   sharesOf(user2) -> 400
 *
 * Therefore:
 *
 *   balanceOf(user1) -> 2 tokens which corresponds 2 ETH
 *   balanceOf(user2) -> 8 tokens which corresponds 8 ETH
 *
 * Since balances of all token holders change when the amount of total pooled Ether
 * changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
 * events upon explicit transfer between holders. In contrast, when total amount of
 * pooled Ether increases, no `Transfer` events are generated: doing so would require
 * emitting an event for each token holder and thus running an unbounded loop.
 *
 * The token inherits from `Pausable` and uses `whenNotStopped` modifier for methods
 * which change `shares` or `allowances`. `_stop` and `_resume` functions are overriden
 * in `Lido.sol` and might be called by an account with the `PAUSE_ROLE` assigned by the
 * DAO. This is useful for emergency scenarios, e.g. a protocol bug, where one might want
 * to freeze all token transfers and approvals until the emergency is resolved.
 */
contract StETH is IERC20, Pausable {
    using SafeMath for uint256;
    using UnstructuredStorage for bytes32;

    /**
     * @dev StETH balances are dynamic and are calculated based on the accounts' shares
     * and the total amount of Ether controlled by the protocol. Account shares aren't
     * normalized, so the contract also stores the sum of all shares to calculate
     * each account's token balance which equals to:
     *
     *   shares[account] * _getTotalPooledEther() / _getTotalShares()
    */
    mapping (address => uint256) private shares;

    /**
     * @dev Allowances are nominated in tokens, not token shares.
     */
    mapping (address => mapping (address => uint256)) private allowances;

    /**
     * @dev Storage position used for holding the total amount of shares in existence.
     *
     * The Lido protocol is built on top of Aragon and uses the Unstructured Storage pattern
     * for value types:
     *
     * https://blog.openzeppelin.com/upgradeability-using-unstructured-storage
     * https://blog.8bitzen.com/posts/20-02-2020-understanding-how-solidity-upgradeable-unstructured-proxies-work
     *
     * For reference types, conventional storage variables are used since it's non-trivial
     * and error-prone to implement reference-type unstructured storage using Solidity v0.4;
     * see https://github.com/lidofinance/lido-dao/issues/181#issuecomment-736098834
     */
    bytes32 internal constant TOTAL_SHARES_VALUE_POSITION = keccak256("lido.Lido.totalShares");

    /**
     * @return the name of the token.
     */
    function name() public pure returns (string) {
        return "Liquid staked Ether 2.0";
    }

    /**
     * @return the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public pure returns (string) {
        return "stETH";
    }

    /**
     * @return the number of decimals for getting user representation of a token amount.
     */
    function decimals() public pure returns (uint8) {
        return 18;
    }

    /**
     * @return the amount of tokens in existence.
     *
     * @dev Always equals to `_getTotalPooledEther()` since token amount
     * is pegged to the total amount of Ether controlled by the protocol.
     */
    function totalSupply() public view returns (uint256) {
        return _getTotalPooledEther();
    }

    /**
     * @return the entire amount of Ether controlled by the protocol.
     *
     * @dev The sum of all ETH balances in the protocol, equals to the total supply of stETH.
     */
    function getTotalPooledEther() public view returns (uint256) {
        return _getTotalPooledEther();
    }

    /**
     * @return the amount of tokens owned by the `account`.
     *
     * @dev Balances are dynamic and equal the account's share in the amount of the
     * total Ether controlled by the protocol. See `getSharesOf`.
     */
    function balanceOf(address account) public view returns (uint256) {
        return getPooledEthByShares(_getSharesOf(account));
    }

    /**
     * @notice Moves `amount` tokens from the caller's account to the `recipient` account.
     *
     * @return a boolean value indicating whether the operation succeeded.
     * Emits a `Transfer` event.
     *
     * Requirements:
     *
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     * - the contract must not be paused.
     *
     * @dev The `amount` parameter is the amount of tokens, not shares.
     */
    function transfer(address recipient, uint256 amount) public returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    /**
     * @return the remaining number of tokens that `spender` is allowed to spend
     * on behalf of `owner` through `transferFrom`. This is zero by default.
     *
     * @dev This value changes when `approve` or `transferFrom` is called.
     */
    function allowance(address owner, address spender) public view returns (uint256) {
        return allowances[owner][spender];
    }

    /**
     * @notice Sets `amount` as the allowance of `spender` over the caller's tokens.
     *
     * @return a boolean value indicating whether the operation succeeded.
     * Emits an `Approval` event.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - the contract must not be paused.
     *
     * @dev The `amount` parameter is the amount of tokens, not shares.
     */
    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Moves `amount` tokens from `sender` to `recipient` using the
     * allowance mechanism. `amount` is then deducted from the caller's
     * allowance.
     *
     * @return a boolean value indicating whether the operation succeeded.
     *
     * Emits a `Transfer` event.
     * Emits an `Approval` event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `sender` and `recipient` cannot be the zero addresses.
     * - `sender` must have a balance of at least `amount`.
     * - the caller must have allowance for `sender`'s tokens of at least `amount`.
     * - the contract must not be paused.
     *
     * @dev The `amount` parameter is the amount of tokens, not shares.
     */
    function transferFrom(address sender, address recipient, uint256 amount) public returns (bool) {
        uint256 currentAllowance = allowances[sender][msg.sender];
        require(currentAllowance >= amount, "TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE");

        _transfer(sender, recipient, amount);
        _approve(sender, msg.sender, currentAllowance.sub(amount));
        return true;
    }

    /**
     * @notice Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to `approve` that can be used as a mitigation for
     * problems described in:
     * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol#L42
     * Emits an `Approval` event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the the zero address.
     * - the contract must not be paused.
     */
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        _approve(msg.sender, spender, allowances[msg.sender][spender].add(addedValue));
        return true;
    }

    /**
     * @notice Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to `approve` that can be used as a mitigation for
     * problems described in:
     * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol#L42
     * Emits an `Approval` event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least `subtractedValue`.
     * - the contract must not be paused.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        uint256 currentAllowance = allowances[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "DECREASED_ALLOWANCE_BELOW_ZERO");
        _approve(msg.sender, spender, currentAllowance.sub(subtractedValue));
        return true;
    }

    /**
     * @notice Returns the total amount of shares in existence.
     *
     * @dev The sum of all accounts' shares can be an arbitrary number, therefore
     * it is necessary to store it in order to calculate each account's relative share.
     */
    function getTotalShares() public view returns (uint256) {
        return _getTotalShares();
    }

    /**
     * @return the amount of shares owned by `account`.
     */
    function getSharesOf(address account) public view returns (uint256) {
        return _getSharesOf(account);
    }

    /**
     * @return the amount of shares that corresponds to `_ethAmount` protocol-controlled Ether.
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
     * @return the amount of Ether that corresponds to `_sharesAmount` token shares.
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
     * @return the total amount (in wei) of Ether controlled by the protocol.
     * @dev This is used for calaulating tokens from shares and vice versa.
     * @dev This function is required to be implemented in a derived contract.
     */
    function _getTotalPooledEther() internal view returns (uint256);

    /**
     * @notice Moves `amount` tokens from `sender` to `recipient`.
     * Emits a `Transfer` event.
     */
    function _transfer(address sender, address recipient, uint256 amount) internal {
        uint256 _sharesToTransfer = getSharesByPooledEth(amount);
        _transferShares(sender, recipient, _sharesToTransfer);
        emit Transfer(sender, recipient, amount);
    }

    /**
     * @notice Sets `amount` as the allowance of `spender` over the `owner` s tokens.
     *
     * Emits an `Approval` event.
     *
     * Requirements:
     *
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
     * @return the total amount of shares in existence.
     */
    function _getTotalShares() internal view returns (uint256) {
        return TOTAL_SHARES_VALUE_POSITION.getStorageUint256();
    }

    /**
     * @return the amount of shares owned by `account`.
     */
    function _getSharesOf(address account) internal view returns (uint256) {
        return shares[account];
    }

    /**
     * @notice Moves `sharesAmount` shares from `sender` to `recipient`.
     *
     * Requirements:
     *
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must hold at least `sharesAmount` shares.
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

    /**
     * @notice Creates `sharesAmount` shares and assigns them to `account`, increasing the total amount of shares.
     * @dev This doesn't increase the token total supply.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the contract must not be paused.
     */
    function _mintShares(address to, uint256 sharesAmount) internal whenNotStopped returns (uint256 newTotalShares) {
        require(to != address(0), "MINT_TO_THE_ZERO_ADDRESS");

        newTotalShares = _getTotalShares().add(sharesAmount);
        TOTAL_SHARES_VALUE_POSITION.setStorageUint256(newTotalShares);

        shares[to] = shares[to].add(sharesAmount);

        // Notice: we're not emitting a Transfer event from the zero address here since shares mint
        // works by taking the amount of tokens corresponding to the minted shares from all other
        // token holders, proportionally to their share. The total supply of the token doesn't change
        // as the result. This is equivalent to performing a send from each other token holder's
        // address to `address`, but we cannot reflect this as it would require sending an unbounded
        // number of events.
    }

    /**
     * @notice Destroys `sharesAmount` shares from `account`'s holdings, decreasing the total amount of shares.
     * @dev This doesn't decrease the token total supply.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * - `account` must hold at least `sharesAmount` shares.
     * - the contract must not be paused.
     */
    function _burnShares(address account, uint256 sharesAmount) internal whenNotStopped returns (uint256 newTotalShares) {
        require(account != address(0), "BURN_FROM_THE_ZERO_ADDRESS");

        uint256 accountShares = shares[account];
        require(sharesAmount <= accountShares, "BURN_AMOUNT_EXCEEDS_BALANCE");

        newTotalShares = _getTotalShares().sub(sharesAmount);
        TOTAL_SHARES_VALUE_POSITION.setStorageUint256(newTotalShares);

        shares[account] = accountShares.sub(sharesAmount);

        // Notice: we're not emitting a Transfer event to the zero address here since shares burn
        // works by redistributing the amount of tokens corresponding to the burned shares between
        // all other token holders. The total supply of the token doesn't change as the result.
        // This is equivalent to performing a send from `address` to each other token holder address,
        // but we cannot reflect this as it would require sending an unbounded number of events.
    }
}
