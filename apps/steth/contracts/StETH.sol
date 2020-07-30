pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import {ERC20 as OZERC20} from "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

import "@depools/dao/contracts/interfaces/ISTETH.sol";
import "@depools/depool-lib/contracts/Pausable.sol";


/**
  * @title Implementation of a liquid version of ETH 2.0 native token
  *
  * ERC20 token which supports stop/resume, mint/burn mechanics. The token is operated by `IDePool`.
  */
contract StETH is ISTETH, Pausable, OZERC20, AragonApp {
    using SafeMath for uint256;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public MINT_ROLE = keccak256("MINT_ROLE");
    bytes32 constant public BURN_ROLE = keccak256("BURN_ROLE");


    function initialize() public onlyInit {
        initialized();
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
      * @notice Stops transfers
      */
    function stop() external auth(PAUSE_ROLE) {
        _stop();
    }

    /**
      * @notice Resumes transfers
      */
    function resume() external auth(PAUSE_ROLE) {
        _resume();
    }


    /**
      * @notice Mints new tokens
      * @param _to Receiver of new tokens
      * @param _value Amount of new tokens to mint
      */
    function mint(address _to, uint256 _value) external authP(MINT_ROLE, arr(_to, _value)) {
        _mint(_to, _value);
    }

    /**
      * @notice Burns tokens
      * @param _account Account which tokens are to be burnt
      * @param _value Amount of tokens to burn
      */
    function burn(address _account, uint256 _value) external authP(BURN_ROLE, arr(_account, _value)) {
        _burn(_account, _value);
    }
}
