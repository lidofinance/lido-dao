pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import {ERC20 as OZERC20} from "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

import "./interfaces/ISTETH.sol";

import "./lib/Pausable.sol";

import "./interfaces/IDePool.sol";


/**
  * @title Implementation of a liquid version of ETH 2.0 native token
  *
  * ERC20 token which supports stop/resume, mint/burn mechanics. The token is operated by `IDePool`.
  */
contract StETH is ISTETH, Pausable, AragonApp {
    using SafeMath for uint256;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public MINT_ROLE = keccak256("MINT_ROLE");
    bytes32 constant public BURN_ROLE = keccak256("BURN_ROLE");

    // DePool contract serves as a source of information on the amount of pooled funds
    // and acts as the 'minter' of the new shares when staker submits his funds
    IDePool public dePool;

    // Shares are the amounts of pooled Ether normalized to the volume of ETH1.0 Ether on the moment of system start.
    // Shares represent how much of initial ether are worth all-time deposits of the given user.
    // In this implementation shares replace traditional balances
    mapping (address => uint256) private _shares;
    // ...and totalShares replace traditional totalSupply counter.
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

    function initialize(IDePool _dePool) public onlyInit {
        dePool = _dePool;
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
    * @dev Total number of tokens in existence
    */
    function totalSupply() public view returns (uint256) {
        return dePool.getTotalControlledEther();
    }

    /**
    * @dev Gets the balance of the specified address.
    * @param owner The address to query the balance of.
    * @return An uint256 representing the amount owned by the passed address.
    */
    function balanceOf(address owner) public view returns (uint256) {
        return getPooledEthByShares(_shares[owner]);
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
    * @dev Transfer token for a specified addresses
    * @param from The address to transfer from.
    * @param to The address to transfer to.
    * @param value The amount to be transferred.
    */
    function _transfer(address from, address to, uint256 value) internal {
        require(value <= _shares[from]);
        require(to != address(0));

        _shares[from] = _shares[from].sub(value);
        _shares[to] = _shares[to].add(value);
        emit Transfer(from, to, value);
    }

    /**
    * @dev Internal function that mints an amount of the token and assigns it to
    * an account. This encapsulates the modification of balances such that the
    * proper events are emitted.
    * @param account The account that will receive the created tokens.
    * @param value The amount that will be created.
    */
    function _mint(address account, uint256 value) internal {
        require(account != 0);
        require(value != 0);
        uint256 sharesDifference;
        uint256 totalControlledEthBefore = dePool.getTotalControlledEther();
        if ( totalControlledEthBefore == 0) {
            sharesDifference = value;
        } else {
            uint256 controlledEthAfter = totalControlledEthBefore.add(value);
            uint256 totalSharesBefore = _totalShares;
            uint256 totalSharesAfter = getSharesByPooledEth(controlledEthAfter);
            sharesDifference = totalSharesAfter.sub(totalSharesBefore);
        }
        _totalShares = _totalShares.add(sharesDifference);
        _shares[account] = _shares[account].add(sharesDifference);
        emit Transfer(address(0), account, value);
    }

    /**
    * @dev Internal function that burns an amount of the token of a given
    * account.
    * @param account The account whose tokens will be burnt.
    * @param value The amount that will be burnt.
    */
    function _burn(address account, uint256 value) internal {
        require(account != 0);
        require(value != 0);
        uint256 sharesToBurn = getSharesByPooledEth(value);
        _totalShares = _totalShares.sub(sharesToBurn);
        _shares[account] = _shares[account].sub(sharesToBurn);
        emit Transfer(account, address(0), value);
    }

    /**
    * @dev Internal function that burns an amount of the token of a given
    * account, deducting from the sender's allowance for said account. Uses the
    * internal burn function.
    * @param account The account whose tokens will be burnt.
    * @param value The amount that will be burnt.
    */
    function _burnFrom(address account, uint256 value) internal {
        require(value <= _allowed[account][msg.sender]);

        // Should https://github.com/OpenZeppelin/zeppelin-solidity/issues/707 be accepted,
        // this function needs to emit an event with the updated approval.
        _allowed[account][msg.sender] = _allowed[account][msg.sender].sub(
        value);
        _burn(account, value);
    }

    /**
      * @notice Mint `@tokenAmount(this, _value)` new tokens to `_to`
      * @param _to Receiver of new tokens
      * @param _value Amount of new tokens to mint
      */
    function mint(address _to, uint256 _value) external whenNotStopped authP(MINT_ROLE, arr(_to, _value)) {
        if (0 == _value)
            return;

        _mint(_to, _value);
    }

    /**
      * @notice processSubmission is called by dePool contract when user submits the ETH1.0 deposit. 
      *         It calculates share difference to preserve ratio of shares to pooled eth, 
      *         so that all the old shares still correspond to the same amount of pooled ethers. 
      *         Then adds the calculated difference to the user's share and to the totalShares
      *         similarly as traditional mint() function does with balances.
      * @param _to Receiver of new shares
      * @param _submittedAmount Amount of submitted ethers in wei
      */
    function processSubmission(address _to, uint256 _submittedAmount) external whenNotStopped authP(MINT_ROLE, arr(_to, _submittedAmount)) {
        // ToDo rename controlledEth to pooledEth
        uint256 controlledEthAfter = dePool.getTotalControlledEther().add(_submittedAmount);
        uint256 totalSharesBefore = _totalShares;
        uint256 totalSharesAfter = getSharesByPooledEth(controlledEthAfter);
        uint256 sharesDifference = totalSharesAfter.sub(totalSharesBefore);
        _shares[_to] = _shares[_to].add(sharesDifference);
        _totalShares = _totalShares.add(sharesDifference);
    }

    /**
      * @notice Burn `@tokenAmount(this, _value)` tokens from `_account`
      * @param _account Account which tokens are to be burnt
      * @param _value Amount of tokens to burn
      */
    function burn(address _account, uint256 _value) external whenNotStopped authP(BURN_ROLE, arr(_account, _value)) {
        if (0 == _value)
            return;

        _burn(_account, _value);
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
        return _sharesAmount.mul(dePool.getTotalControlledEther()).div(_totalShares);
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
        if (dePool.getTotalControlledEther() == 0) {
            return 0;
        }
        return _totalShares.mul(_pooledEthAmount).div(dePool.getTotalControlledEther());
    }

    /**
    * @dev Return the sum of the shares of all holders for better external visibility
    */ 
    function getTotalShares() public view returns (uint256) {
        return _totalShares;
    }
}
