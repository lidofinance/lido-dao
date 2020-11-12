/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "./interfaces/ISTETH.sol";
import "./interfaces/ILido.sol";

import "./lib/Pausable.sol";


/**
  * @title Implementation of a liquid version of ETH 2.0 native token
  *
  * ERC20 token which supports stop/resume mechanics. The token is operated by `ILido`.
  *
  * Since balances of all token holders change when the amount of total controlled Ether
  * changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
  * events upon explicit transfer between holders. In contrast, when Lido oracle reports
  * rewards, no Transfer events are generated: doing so would require emitting an event
  * for each token holder and thus running an unbounded loop.
  */
contract StETH is ISTETH, Pausable, AragonApp {
    using SafeMath for uint256;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public MINT_ROLE = keccak256("MINT_ROLE");
    bytes32 constant public BURN_ROLE = keccak256("BURN_ROLE");

    // Lido contract serves as a source of information on the amount of pooled funds
    // and acts as the 'minter' of the new shares when staker submits his funds
    ILido public lido;

    // Shares are the amounts of pooled Ether 'discounted' to the volume of ETH1.0 Ether deposited on the first day
    // or, more precisely, to Ethers deposited from start until the first oracle report.
    // Shares represent how much of first-day ether are worth all-time deposits of the given user.
    // In this implementation token stores relative shares, not fixed balances.
    mapping (address => uint256) private _shares;
    uint256 private _totalShares;

    mapping (address => mapping (address => uint256)) private _allowed;

    event Transfer(
        address indexed from,
        address indexed to,
        uint256 value
    );

    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );

    function initialize(ILido _lido) public onlyInit {
        lido = _lido;
        initialized();
    }

    /**
      * @notice Stop transfers
      */
    function stop() external auth(PAUSE_ROLE) {
        _stop();
    }

    /**
      * @notice Resume transfers
      */
    function resume() external auth(PAUSE_ROLE) {
        _resume();
    }

    /**
    * @notice Increases shares of a given address by the specified amount. Called by Lido
    *         contract in two cases: 1) when a user submits an ETH1.0 deposit; 2) when
    *         ETH2.0 rewards are reported by the oracle. Upon user deposit, Lido contract
    *         mints the amount of shares that corresponds to the submitted Ether, so
    *         token balances of other token holders don't change. Upon rewards report,
    *         Lido contract mints new shares to distribute fee, effectively diluting the
    *         amount of Ether that would otherwise correspond to each share.
    *
    * @param _to Receiver of new shares
    * @param _sharesAmount Amount of shares to mint
    * @return The total amount of all holders' shares after new shares are minted
    */
    function mintShares(address _to, uint256 _sharesAmount)
        external
        whenNotStopped
        authP(MINT_ROLE, arr(_to, _sharesAmount))
        returns (uint256 newTotalShares)
    {
        require(_to != address(0));
        newTotalShares = _totalShares.add(_sharesAmount);
        _totalShares = newTotalShares;
        _shares[_to] = _shares[_to].add(_sharesAmount);
        // no Transfer events emitted, see the comment at the top
    }

    /**
      * @notice Burn is called by Lido contract when a user withdraws their Ether.
      * @param _account Account which tokens are to be burnt
      * @param _sharesAmount Amount of shares to burn
      * @return The total amount of all holders' shares after the shares are burned
      */
    function burnShares(address _account, uint256 _sharesAmount)
        external
        whenNotStopped
        authP(BURN_ROLE, arr(_account, _sharesAmount))
        returns (uint256 newTotalShares)
    {
        require(_account != address(0));
        newTotalShares = _totalShares.sub(_sharesAmount);
        _totalShares = newTotalShares;
        _shares[_account] = _shares[_account].sub(_sharesAmount);
        // no Transfer events emitted, see the comment at the top
    }

    /**
    * @dev Total number of tokens in existence
    */
    function totalSupply() public view returns (uint256) {
        return lido.getTotalPooledEther();
    }

    /**
    * @dev Gets the balance of the specified address.
    * @param owner The address to query the balance of.
    * @return An uint256 representing the amount owned by the passed address.
    */
    function balanceOf(address owner) public view returns (uint256) {
        return getPooledEthByHolder(owner);
    }

    /**
    * @dev Function to check the amount of tokens that an owner allowed to a spender.
    * @param owner address The address which owns the funds.
    * @param spender address The address which will spend the funds.
    * @return A uint256 specifying the amount of tokens still available for the spender.
    */
    function allowance(
        address owner,
        address spender
    )
        public
        view
        returns (uint256)
    {
        return _allowed[owner][spender];
    }

    /**
    * @dev Transfer token for a specified address
    * @param to The address to transfer to.
    * @param value The amount to be transferred.
    */
    function transfer(address to, uint256 value) public whenNotStopped returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /**
    * @dev Approve the passed address to spend the specified amount of tokens on behalf of msg.sender.
    * Beware that changing an allowance with this method brings the risk that someone may use both the old
    * and the new allowance by unfortunate transaction ordering. One possible solution to mitigate this
    * race condition is to first reduce the spender's allowance to 0 and set the desired value afterwards:
    * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
    * @param spender The address which will spend the funds.
    * @param value The amount of tokens to be spent.
    */
    function approve(address spender, uint256 value) public whenNotStopped returns (bool) {
        require(spender != address(0));

        _allowed[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /**
    * @dev Transfer tokens from one address to another
    * @param from address The address which you want to send tokens from
    * @param to address The address which you want to transfer to
    * @param value uint256 the amount of tokens to be transferred
    */
    function transferFrom(
        address from,
        address to,
        uint256 value
    )
        public
        whenNotStopped
        returns (bool)
    {
        require(value <= _allowed[from][msg.sender]);

        _allowed[from][msg.sender] = _allowed[from][msg.sender].sub(value);
        _transfer(from, to, value);
        return true;
    }

    /**
    * @dev Increase the amount of tokens that an owner allowed to a spender.
    * approve should be called when allowed_[_spender] == 0. To increment
    * allowed value is better to use this function to avoid 2 calls (and wait until
    * the first transaction is mined)
    * From MonolithDAO Token.sol
    * @param spender The address which will spend the funds.
    * @param addedValue The amount of tokens to increase the allowance by.
    */
    function increaseAllowance(
        address spender,
        uint256 addedValue
    )
        public
        whenNotStopped
        returns (bool)
    {
        require(spender != address(0));

        _allowed[msg.sender][spender] = (
        _allowed[msg.sender][spender].add(addedValue));
        emit Approval(msg.sender, spender, _allowed[msg.sender][spender]);
        return true;
    }

    /**
    * @dev Decrease the amount of tokens that an owner allowed to a spender.
    * approve should be called when allowed_[_spender] == 0. To decrement
    * allowed value is better to use this function to avoid 2 calls (and wait until
    * the first transaction is mined)
    * From MonolithDAO Token.sol
    * @param spender The address which will spend the funds.
    * @param subtractedValue The amount of tokens to decrease the allowance by.
    */
    function decreaseAllowance(
        address spender,
        uint256 subtractedValue
    )
        public
        whenNotStopped
        returns (bool)
    {
        require(spender != address(0));

        _allowed[msg.sender][spender] = (
        _allowed[msg.sender][spender].sub(subtractedValue));
        emit Approval(msg.sender, spender, _allowed[msg.sender][spender]);
        return true;
    }

    /**
     * @notice Returns the name of the token.
     */
    function name() public pure returns (string) {
        return "Liquid staked Ether 2.0";
    }

    /**
     * @notice Returns the symbol of the token.
     */
    function symbol() public pure returns (string) {
        return "StETH";
    }

    /**
     * @notice Returns the number of decimals of the token.
     */
    function decimals() public pure returns (uint8) {
        return 18;
    }

    /**
    * @dev Return the amount of shares that given holder has.
    * @param _holder The address of the holder
    */
    function getSharesByHolder(address _holder) public view returns (uint256) {
        return _shares[_holder];
    }

    /**
    * @dev Return the amount of pooled ethers for given amount of shares
    * @param _sharesAmount The amount of shares
    */
    function getPooledEthByShares(uint256 _sharesAmount) public view returns (uint256) {
        if (_totalShares == 0) {
            return 0;
        }
        return _sharesAmount.mul(lido.getTotalPooledEther()).div(_totalShares);
    }

    /**
    * @dev Return the amount of pooled ethers for given holder
    * @param _holder The address of the holder
    */
    function getPooledEthByHolder(address _holder) public view returns (uint256) {
        uint256 holderShares = getSharesByHolder(_holder);
        uint256 holderPooledEth = getPooledEthByShares(holderShares);
        return holderPooledEth;
    }

    /**
    * @dev Return the amount of shares backed by given amount of pooled Eth
    * @param _pooledEthAmount The amount of pooled Eth
    */
    function getSharesByPooledEth(uint256 _pooledEthAmount) public view returns (uint256) {
        if (lido.getTotalPooledEther() == 0) {
            return 0;
        }
        return _pooledEthAmount.mul(_totalShares).div(lido.getTotalPooledEther());
    }

    /**
    * @dev Return the sum of the shares of all holders for better external visibility
    */
    function getTotalShares() public view returns (uint256) {
        return _totalShares;
    }

    /**
    * @dev Transfer token for a specified addresses
    * @param from The address to transfer from.
    * @param to The address to transfer to.
    * @param value The amount to be transferred.
    */
    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0));
        uint256 sharesToTransfer = getSharesByPooledEth(value);
        require(sharesToTransfer <= _shares[from]);
        _shares[from] = _shares[from].sub(sharesToTransfer);
        _shares[to] = _shares[to].add(sharesToTransfer);
        emit Transfer(from, to, value);
    }
}
