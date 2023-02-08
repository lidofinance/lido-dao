// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

interface IPausableUntil {
    function pause(uint256 _duration) external;
}

/**
 * @title GateSeal
 * @author mymphe
 * @notice A one-time pause for a set duration for a PausableUntil contract;
 * @dev    This contract is meant to be used as a panic button for a critical contract;
 *
 *         In a state of emergency, the pauser (a multisig committee) can pause (seal the gate)
 *         the contract for a set duration, e.g. one week, bypassing the DAO voting;
 *         This will give the DAO some time to analyze the situation, hold a vote, etc.;
 *
 *         To reduce the protocol's reliance on this mechanism,
 *         GateSeal will expire in a set amount of time;
 *         and a new GateSeal with a new committee will have to be deployed;
 *
 *         Sealing the gate will also expire the contract immediately.
 *
 */
contract GateSeal {
    error ZeroAddress();
    error NotInitializer();
    error NotPauser();

    /**
     * @dev GateSeal can be in three states:
     *      1. Uninitialized: deployed only, no config set, awaiting initialization,
     *         Not setting config at construction gives more flexibility, 
     *         e.g. pre-deploy from a dev acount and set the DAO Agent as initializer;
     *      2. Initialized: normal operation, the committee can pause the pausable;
     *      3. Expired: no longer usable, either expired with time or sealGate was called.
     */
    error YetUninitialized();
    error AlreadyInitialized();
    error Expired();

    event Initialized(address pausable, address pauser, uint256 pauseDuration, uint256 expiryDate);
    event GateSealed(address pausable, address pauser, uint256 pauseDuration);

    /**
     * @dev account that can set the config
     */
    address internal initializer;

    /**
     * @dev contract implementing PausableUntil,
     *      i.e. has a function `pause(uint256 _duration)`
     */
    address internal pausable;

    /**
     * @dev account that can seal the gate,
     *      intended to be a multisig committee
     */
    address internal pauser;

    /**
     * @dev period in seconds for which the pausable will be paused
     */
    uint256 internal pauseDuration;

    /**
     * @dev unix timestamp past which GateSeal will be unusable 
     */
    uint256 internal expiryDate;


    constructor(address _initializer) {
        if (_initializer == address(0)) revert ZeroAddress();

        initializer = _initializer;
    }

    function getInitializer() external view returns(address) {
        return initializer;
    }

    function getPausable() external view returns(address) {
        return pausable;
    }

    function getPauser() external view returns(address) {
        return pauser;
    }

    function getPauseDuration() external view returns(uint256) {
        return pauseDuration;
    }

    function getExpiryDate() external view returns(uint256) {
        return expiryDate;
    }

    function isInitialized() external view returns(bool) {
        return _isInitialized();
    }

    function isExpired() external view returns(bool) {
        return _isExpired();
    }

    /**
     * @notice set the seal config and expiration
     * @dev can only be called by the initializer set at construction;
     * @param _pausable contract to be paused
     * @param _pauser account that can pause the contract, multisig committee
     * @param _pauseDuration seconds to pause for
     * @param _shelfLife period after which GateSeal becomes unusable;
     *                   starting from the moment this function is called
     */
    function initialize(
        address _pausable,
        address _pauser,
        uint256 _pauseDuration,
        uint256 _shelfLife
    ) external {
        if (_isInitialized()) revert AlreadyInitialized();
        if (msg.sender != initializer) revert NotInitializer();
        if (_pausable == address(0)) revert ZeroAddress();
        if (_pauser == address(0)) revert ZeroAddress();

        initializer = address(0);

        pausable = _pausable;
        pauser = _pauser;
        pauseDuration = _pauseDuration;

        expiryDate = block.timestamp + _shelfLife;

        emit Initialized(_pausable, _pauser, _pauseDuration, expiryDate);
    }

    /**
     * @notice pause the contract and expire this GateSeal
     * @dev can only be called by the pauser;
     *      expiring the contract by way of setting `expiryDate` to the past second
     */
    function sealGate() external {
        if (!_isInitialized()) revert YetUninitialized();
        if (_isExpired()) revert Expired();
        if (msg.sender != pauser) revert NotPauser();

        expiryDate = block.timestamp - 1;

        IPausableUntil(pausable).pause(pauseDuration);

        emit GateSealed(pausable, pauser, pauseDuration);
    }

    function _isInitialized() internal view returns(bool) {
        return initializer == address(0);
    }

    function _isExpired() internal view returns(bool) {
        return block.timestamp > expiryDate;
    }
}
