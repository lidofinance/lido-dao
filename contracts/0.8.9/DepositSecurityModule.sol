// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {BytesLib} from "./lib/BytesLib.sol";


interface IDepositContract {
    function get_deposit_root() external view returns (bytes32 rootHash);
}


interface ILido {
    function depositBufferedEther(uint256 maxDeposits) external;
}


interface INodeOperatorsRegistry {
    function getKeysOpIndex() external view returns (uint256 index);
}


contract DepositSecurityModule {
    using BytesLib for bytes;


    event OwnerChanged(address newValue);
    event NodeOperatorsRegistryChanged(address newValue);
    event PauseIntentValidityPeriodBlocksChanged(uint256 newValue);
    event MaxDepositsChanged(uint256 newValue);
    event MinDepositBlockDistanceChanged(uint256 newValue);
    event GuardianQuorumChanged(uint256 newValue);
    event GuardianAdded(address guardian);
    event GuardianRemoved(address guardian);
    event DepositsPaused(address guardian);
    event DepositsUnpaused();


    // keccak256("lido.DepositSecurityModule.ATTEST_MESSAGE")
    bytes32 public constant ATTEST_MESSAGE_PREFIX = 0x1085395a994e25b1b3d0ea7937b7395495fb405b31c7d22dbc3976a6bd01f2bf;

    // keccak256("lido.DepositSecurityModule.PAUSE_MESSAGE");
    bytes32 public constant PAUSE_MESSAGE_PREFIX = 0x9c4c40205558f12027f21204d6218b8006985b7a6359bcab15404bcc3e3fa122;

    uint256 constant ATTEST_SIGNATURE_LEN = 1 + 1 + 32 + 32;

    address internal immutable LIDO;
    address internal immutable DEPOSIT_CONTRACT;

    address internal nodeOperatorsRegistry;
    uint256 internal maxDepositsPerBlock;
    uint256 internal minDepositBlockDistance;
    uint256 internal pauseIntentValidityPeriodBlocks;

    address internal owner;

    address[] internal guardians;
    mapping(address => bool) guardianFlags;
    uint256 internal quorum;

    bool internal paused;
    uint256 internal lastDepositBlock;


    constructor(address _lido, address _depositContract, address _nodeOperatorsRegistry) {
        LIDO = _lido;
        DEPOSIT_CONTRACT = _depositContract;

        _setOwner(msg.sender);
        _setNodeOperatorsRegistry(_nodeOperatorsRegistry);

        paused = false;
        lastDepositBlock = 0;
    }


    /**
     * Returns the owner address.
     */
    function getOwner() external view returns (address) {
        return owner;
    }

    modifier onlyOwner {
        require(msg.sender == owner, "not an owner");
        _;
    }

    /**
     * Sets new owner. Only callable by the current owner.
     */
    function setOwner(address newValue) external onlyOwner {
        _setOwner(newValue);
    }

    function _setOwner(address newValue) internal {
        owner = newValue;
        emit OwnerChanged(newValue);
    }


    /**
     * Returns NodeOperatorsRegistry contract address.
     */
    function getNodeOperatorsRegistry() external view returns (address) {
        return nodeOperatorsRegistry;
    }

    /**
     * Sets NodeOperatorsRegistry contract address. Only callable by the owner.
     */
    function setNodeOperatorsRegistry(address newValue) external onlyOwner {
        _setNodeOperatorsRegistry(newValue);
    }

    function _setNodeOperatorsRegistry(address newValue) internal {
        nodeOperatorsRegistry = newValue;
        emit NodeOperatorsRegistryChanged(newValue);
    }


    /**
     * Returns `PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS` (see `pauseDeposits`).
     */
    function getPauseIntentValidityPeriodBlocks() external view returns (uint256) {
        return pauseIntentValidityPeriodBlocks;
    }

    /**
     * Returns `PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS`. Only callable by the owner.
     */
    function setPauseIntentValidityPeriodBlocks(uint256 newValue) external onlyOwner {
        pauseIntentValidityPeriodBlocks = newValue;
        emit PauseIntentValidityPeriodBlocksChanged(newValue);
    }


    /**
     * Returns `MAX_DEPOSITS` (see `depositBufferedEther`).
     */
    function getMaxDeposits() external view returns (uint256) {
        return maxDepositsPerBlock;
    }

    /**
     * Sets `MAX_DEPOSITS`. Only callable by the owner.
     */
    function setMaxDeposits(uint256 newValue) external onlyOwner {
        maxDepositsPerBlock = newValue;
        emit MaxDepositsChanged(newValue);
    }


    /**
     * Returns `MIN_DEPOSIT_BLOCK_DISTANCE`  (see `depositBufferedEther`).
     */
    function getMinDepositBlockDistance() external view returns (uint256) {
        return minDepositBlockDistance;
    }

    /**
     * Sets `MIN_DEPOSIT_BLOCK_DISTANCE`. Only callable by the owner.
     */
    function setMinDepositBlockDistance(uint256 newValue) external onlyOwner {
        minDepositBlockDistance = newValue;
        emit MinDepositBlockDistanceChanged(newValue);
    }


    /**
     * Returns number of valid guardian signatures required to vet (depositRoot, keysOpIndex) pair.
     */
    function getGuardianQuorum() external view returns (uint256) {
        return quorum;
    }

    function setGuardianQuorum(uint256 newValue) external onlyOwner {
        _setGuardianQuorum(newValue);
    }


    /**
     * Returns guardian committee member list.
     */
    function getGuardians() external view returns (address[] memory) {
        return guardians;
    }

    /**
     * Checks whether the given address is a guardian.
     */
    function isGuardian(address addr) external view returns (bool) {
        return _isGuardian(addr);
    }

    /**
     * Adds a guardian address. Reverts if the address is already a guardian.
     *
     * Only callable by the owner.
     */
    function addGuardian(address addr) external onlyOwner {
        _addGuardian(addr);
    }

    /**
     * Adds a set of guardian addresses. Reverts any of them is already a guardian.
     *
     * Only callable by the owner.
     */
    function addGuardians(address[] memory addresses) external onlyOwner {
        for (uint256 i = 0; i < addresses.length; ++i) {
            _addGuardian(addresses[i]);
        }
    }

    /**
     * Removes a guardian with the given index.
     *
     * Only callable by the owner.
     */
    function removeGuardian(uint256 index) external onlyOwner {
        uint256 totalGuardians = guardians.length;

        require(index < totalGuardians, "invalid index");
        --totalGuardians;

        address addr = guardians[index];
        guardianFlags[addr] = false;

        for (uint256 j = index; j < totalGuardians; ++j) {
            guardians[j] = guardians[j + 1];
        }

        if (quorum > totalGuardians) {
            _setGuardianQuorum(totalGuardians);
        }

        guardians.pop();

        emit GuardianRemoved(addr);
    }


    /**
     * Returns whether deposits were paused.
     */
    function isPaused() external view returns (bool) {
        return paused;
    }

    /**
     * Pauses deposits given that both conditions are satisfied (reverts otherwise):
     *
     *   1. The function is called by the guardian with index guardianIndex OR (v, r, s)
     *      is a valid signature by the guardian with index guardianIndex of the data
     *      defined below.
     *
     *   2. block.number - blockHeight <= PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS
     *
     * The signature, if present, must be produced for keccak256 hash of a message with
     * the following layout:
     *
     * | PAUSE_MESSAGE_PREFIX: bytes32 | blockHeight: uint256 |
     */
    function pauseDeposits(
        uint256 blockHeight,
        uint256 guardianIndex,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        address guardianAddr = guardians[guardianIndex];

        if (msg.sender != guardianAddr) {
            bytes32 msgHash = keccak256(abi.encodePacked(PAUSE_MESSAGE_PREFIX, blockHeight));
            address signerAddr = _recoverSignature(msgHash, v, r, s);
            require(signerAddr == guardianAddr, "invalid signature");
        }

        require(
            block.number - blockHeight <= pauseIntentValidityPeriodBlocks,
            "pause intent expired"
        );

        if (!paused) {
            paused = true;
            emit DepositsPaused(guardianAddr);
        }
    }

    /**
     * Unpauses deposits.
     *
     * Only callable by the owner.
     */
    function unpauseDeposits() external onlyOwner {
        if (paused) {
            paused = false;
            emit DepositsUnpaused();
        }
    }


    /**
     * Calls Lido.depositBufferedEther(maxDeposits), which is not
     * callable in any other way.
     *
     * Reverts if any of the following is true:
     *   1. IDepositContract.get_deposit_root() != depositRoot.
     *   2. INodeOperatorsRegistry.getKeysOpIndex() != keysOpIndex.
     *   3. The number of valid guardian signatures is less than getGuardianQuorum().
     *   4. maxDeposits > MAX_DEPOSITS
     *   5. block.number - lastLidoDepositBlock < MIN_DEPOSIT_BLOCK_DISTANCE
     *
     * Layout of guardianSignatures:
     *
     * guardianSignatures := | sig... |
     * sig := | memberIndex: uint8 | v: uint8 | r: bytes32 | s: bytes32 |
     *
     * Signatures must be sorted in ascending order by the memberIndex.
     * Each of guardian signatures must be produced for keccak256 hash of a message
     * with the following layout:
     *
     * | ATTEST_MESSAGE_PREFIX: bytes32 | depositRoot: bytes32 | keysOpIndex: uint256 |
     */
    function depositBufferedEther(
        uint256 maxDeposits,
        bytes32 depositRoot,
        uint256 keysOpIndex,
        bytes memory guardianSignatures
    ) external {
        require(!paused, "deposits are paused");

        require(maxDeposits <= maxDepositsPerBlock, "too many deposits");
        require(block.number - lastDepositBlock >= minDepositBlockDistance, "too frequent deposits");

        bytes32 onchainDepositRoot = IDepositContract(DEPOSIT_CONTRACT).get_deposit_root();
        require(depositRoot == onchainDepositRoot, "deposit root changed");

        uint256 onchainKeysOpIndex = INodeOperatorsRegistry(nodeOperatorsRegistry).getKeysOpIndex();
        require(keysOpIndex == onchainKeysOpIndex, "keys op index changed");

        uint256 numValidSignatures = _verifySignatures(depositRoot, keysOpIndex, guardianSignatures);
        require(quorum > 0 && numValidSignatures >= quorum, "no guardian quorum");

        ILido(LIDO).depositBufferedEther(maxDeposits);
        lastDepositBlock = block.number;
    }


    function _isGuardian(address addr) internal view returns (bool) {
        return guardianFlags[addr];
    }


    function _addGuardian(address addr) internal {
        require(!_isGuardian(addr), "duplicate address");
        guardians.push(addr);
        guardianFlags[addr] = true;
        emit GuardianAdded(addr);
    }


    function _setGuardianQuorum(uint256 newValue) internal {
        // we're intentionally allowing setting quorum value higher than the number of quardians
        quorum = newValue;
        emit GuardianQuorumChanged(newValue);
    }


    function _verifySignatures(
        bytes32 depositRoot,
        uint256 keysOpIndex,
        bytes memory sigs
    )
        internal view returns (uint256)
    {
        require(sigs.length % ATTEST_SIGNATURE_LEN == 0, "invalid sigs length");
        uint256 numSignatures = sigs.length / ATTEST_SIGNATURE_LEN;

        bytes32 msgHash = keccak256(abi.encodePacked(ATTEST_MESSAGE_PREFIX, depositRoot, keysOpIndex));

        address[] memory members = guardians;
        uint256 numValidSignatures = 0;
        uint256 offset = 0;
        uint256 prevGuardianIndex = 0;

        for (uint256 i = 0; i < numSignatures; ++i) {
            uint256 guardianIndex = sigs.toUint8(offset);
            offset += 1;

            require(i == 0 || guardianIndex > prevGuardianIndex, "signature indices not in ascending order");
            prevGuardianIndex = guardianIndex;

            uint8 v = sigs.toUint8(offset);
            offset += 1;

            bytes32 r = sigs.toBytes32(offset);
            offset += 32;

            bytes32 s = sigs.toBytes32(offset);
            offset += 32;

            address signerAddr = _recoverSignature(msgHash, v, r, s);
            if (signerAddr == members[guardianIndex]) {
                ++numValidSignatures;
            }
        }

        return numValidSignatures;
    }


    function _recoverSignature(bytes32 hash, uint8 v, bytes32 r, bytes32 s)
        internal pure returns (address)
    {
        // Copied from: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v3.4.0/contracts/cryptography/ECDSA.sol#L53

        // EIP-2 still allows signature malleability for ecrecover(). Remove this possibility and make the signature
        // unique. Appendix F in the Ethereum Yellow paper (https://ethereum.github.io/yellowpaper/paper.pdf), defines
        // the valid range for s in (281): 0 < s < secp256k1n ÷ 2 + 1, and for v in (282): v ∈ {27, 28}. Most
        // signatures from current libraries generate a unique signature with an s-value in the lower half order.
        //
        // If your library generates malleable signatures, such as s-values in the upper range, calculate a new s-value
        // with 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - s1 and flip v from 27 to 28 or
        // vice versa. If your library also generates signatures with 0/1 for v instead 27/28, add 27 to v to accept
        // these malleable signatures as well.
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "ECDSA: invalid signature 's' value");
        require(v == 27 || v == 28, "ECDSA: invalid signature 'v' value");

        // If the signature is valid (and not malleable), return the signer address
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "ECDSA: invalid signature");

        return signer;
    }
}
