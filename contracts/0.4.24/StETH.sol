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
 * @dev This contract is abstract. To make the contract deployable override the `_getTotalPooledEther` function
 * Lido.sol contract inherits StETH and defines the `_getTotalPooledEther` function.
 *
 * @notice StETH balances are dynamic and represent the holder's share
 * in the amount of the protocol's Ether 2.0 pool.
 * While the regular token transfers change the shares only,
 * the Lido protocol has methods affecting both the shares distribution
 * and the total amount of Ether 2.0
 *
 */
contract StETH is IERC20, Pausable {
    using SafeMath for uint256;
    using UnstructuredStorage for bytes32;

    // Shares are the amounts of pooled Ether 'discounted' to the volume of ETH1.0 Ether deposited on the first day
    // or, more precisely, to Ethers deposited from start until the first oracle report.
    // Shares represent the worth of a user's all-time deposits in the "first-day ether"
    // Current implementation stores relative shares, not fixed balances.
    mapping (address => uint256) private shares;
    mapping (address => mapping (address => uint256)) private allowances;

    /// @dev the amount of existing shares
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
     * @notice Get the entire amount of Ether controlled by the system
     * @dev The summary of all the balances in the system, equals to the total supply of stETH.
     * @return uint256 of total assets in the pool
     */
    function getTotalPooledEther() external view returns (uint256) {
        return _getTotalPooledEther();
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() external view returns (uint256) {
        return _getTotalPooledEther();
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) external view returns (uint256) {
        return getPooledEthByShares(_getSharesOf(account));
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     *
     * @notice the `amount` in parameters is amount of token, not shares
     */
    function transfer(address recipient, uint256 amount) public returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender) public view returns (uint256) {
        return allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
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
    function transferFrom(address sender, address recipient, uint256 amount) public returns (bool) {
        require(allowances[sender][msg.sender] >= amount, "TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE");
        _transfer(sender, recipient, amount);
        _approve(sender, msg.sender, allowances[sender][msg.sender].sub(amount));
        return true;
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
        _approve(msg.sender, spender, allowances[msg.sender][spender].add(addedValue));
        return true;
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
        require(allowances[msg.sender][spender] >= subtractedValue, "DECREASED_ALLOWANCE_BELLOW_ZERO");
        _approve(msg.sender, spender, allowances[msg.sender][spender].sub(subtractedValue));
        return true;
    }

    /**
      * @dev Gets the total amount of shares
      * @return total amount of shares
    */
    function getTotalShares() external view returns (uint256) {
        return _getTotalShares();
    }

    /**
     * @dev Returns the amount of shares owned by `account`.
     * @return amount of shares owned by `account`
     */
    function getSharesOf(address account) external view returns (uint256) {
        return _getSharesOf(account);
    }

    /**
     * @dev Returns the amount of shares that corresponds to `_ethAmount`.
     * @return amount of shares that corresponds to `_ethAmount`
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
     * @return amount of ether that corresponds to `_sharesAmount`
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
     * @dev Gets the total amount of Ether controlled by the system
     * which is the base for shares and token balance computations
     * @return total balance in wei
     */
    function _getTotalPooledEther() internal view returns (uint256);

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     * This is internal function is equivalent to {transfer}, and it perfarm a call
     * to the {Lido-transfer}, that convert token value to shares and checks follwing
     * requirements:
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount` tokens.
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
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     */
    function _approve(address owner, address spender, uint256 amount) internal whenNotStopped {
        require(owner != address(0), "APPROVE_FROM_ZERO_ADDRESS");
        require(spender != address(0), "APPROVE_TO_ZERO_ADDRESS");

        allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /**
      * @dev Gets the total amount of shares
      * @return total total amount of shares
    */
    function _getTotalShares() internal view returns (uint256) {
        return TOTAL_SHARES_VALUE_POSITION.getStorageUint256();
    }

    /**
     * @dev Returns the amount of shares owned by `account`.
     * @return amount of shares owned by `account`
     */
    function _getSharesOf(address account) internal view returns (uint256) {
        return shares[account];
    }

    /**
     * @dev transfers shares
     */
    function _transferShares(address sender, address recipient, uint256 sharesAmount) internal whenNotStopped {
        require(sender != address(0));
        require(recipient != address(0));
        require(sharesAmount <= shares[sender], 'TRANSFER_AMOUNT_EXCEEDS_BALANCE');

        shares[sender] = shares[sender].sub(sharesAmount);
        shares[recipient] = shares[recipient].add(sharesAmount);
    }

    function _mintShares(address to, uint256 sharesAmount) internal whenNotStopped returns (uint256 newTotalShares) {
        require(to != address(0));

        newTotalShares = _getTotalShares().add(sharesAmount);
        TOTAL_SHARES_VALUE_POSITION.setStorageUint256(newTotalShares);

        shares[to] = shares[to].add(sharesAmount);
    }

    function _burnShares(address account, uint256 sharesAmount) internal whenNotStopped returns (uint256 newTotalShares) {
        require(account != address(0));

        newTotalShares = _getTotalShares().sub(sharesAmount);
        TOTAL_SHARES_VALUE_POSITION.setStorageUint256(newTotalShares);

        shares[account] = shares[account].sub(sharesAmount);
    }
}
