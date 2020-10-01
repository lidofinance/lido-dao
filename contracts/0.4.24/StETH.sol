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
contract StETH is ISTETH, Pausable, OZERC20, AragonApp {

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
     * @notice Transfer token for a specified address
     * @param _to The address to transfer to.
     * @param _value The amount to be transferred.
     * @return True on success, false on failure.
     */
    function transfer(address _to, uint256 _value) public whenNotStopped returns (bool) {
        return super.transfer(_to, _value);
    }

    /**
     * @notice Transfer tokens from one address to another
     * @param _from address The address which you want to send tokens from
     * @param _to address The address which you want to transfer to
     * @param _value uint256 the amount of tokens to be transferred
     * @return True on success, false on failure.
     */
    function transferFrom(address _from, address _to, uint256 _value) public whenNotStopped returns (bool) {
        return super.transferFrom(_from, _to, _value);
    }

    /**
     * @notice Approve `spender` to spend `value` on behalf of msg.sender.
     * @param _spender The address which will spend the funds.
     * @param _value The amount of tokens to be spent.
     * @return True on success, false on failure.
     */
    function approve(address _spender, uint256 _value) public whenNotStopped returns (bool) {
        return super.approve(_spender, _value);
    }

    /**
     * @notice Increase the amount of tokens that an owner allowed to a spender.
     * @param _spender The address which will spend the funds.
     * @param _addedValue The amount of tokens to increase the allowance by.
     * @return True on success, false on failure.
     */
    function increaseAllowance(address _spender, uint _addedValue) public whenNotStopped returns (bool) {
        return super.increaseAllowance(_spender, _addedValue);
    }

    /**
     * @notice Decrease the amount of tokens that an owner allowed to a spender.
     * @param _spender The address which will spend the funds.
     * @param _subtractedValue The amount of tokens to decrease the allowance by.
     * @return True on success, false on failure.
     */
    function decreaseAllowance(address _spender, uint _subtractedValue) public whenNotStopped returns (bool) {
        return super.decreaseAllowance(_spender, _subtractedValue);
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
}
