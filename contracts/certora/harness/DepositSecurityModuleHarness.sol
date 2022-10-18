// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "../../0.8.9/DepositSecurityModule.sol";

contract DepositSecurityModuleHarness is DepositSecurityModule{

constructor(
        address _lido,
        address _depositContract,
        address _nodeOperatorsRegistry,
        uint256 _networkId,
        uint256 _maxDepositsPerBlock,
        uint256 _minDepositBlockDistance,
        uint256 _pauseIntentValidityPeriodBlocks
    ) DepositSecurityModule(

        _lido,
        _depositContract,
        _nodeOperatorsRegistry,
        _networkId,
        _maxDepositsPerBlock,
        _minDepositBlockDistance,
        _pauseIntentValidityPeriodBlocks
    ){}

        function formSignatureArray(Signature memory guardianSignature1) external returns(Signature[] memory sortedGuardianSignatures) {
                            // Signature memory guardianSignature2,
                            // Signature memory guardianSignature3) external returns(Signature[] memory sortedGuardianSignatures) {

            Signature[] memory sortedGuardianSignatures = new Signature[](1);
            
            sortedGuardianSignatures[0] = guardianSignature1;

            // Signature[] memory sortedGuardianSignatures = new Signature[](3);
            
            // sortedGuardianSignatures[0] = guardianSignature1;
            // sortedGuardianSignatures[1] = guardianSignature2;
            // sortedGuardianSignatures[2] = guardianSignature3;

            
        }

        function getGuardianLength() external returns(uint256){
            return guardians.length;
        }

        function depositBufferedEtherHarness(bytes32 depositRoot, 
                                                uint256 keysOpIndex, 
                                                uint256 blockNumber, 
                                                bytes32 blockHash, 
                                                Signature memory guardianSignature1, 
                                                Signature memory guardianSignature2, 
                                                Signature memory guardianSignature3)public {
            Signature[] memory sortedGuardianSignatures = new Signature[](3);
            
            sortedGuardianSignatures[0] = guardianSignature1;
            sortedGuardianSignatures[1] = guardianSignature2;
            sortedGuardianSignatures[2] = guardianSignature3;

            bytes32 onchainDepositRoot = IDepositContract(DEPOSIT_CONTRACT).get_deposit_root();
        require(depositRoot == onchainDepositRoot, "deposit root changed");

        require(!paused, "deposits are paused");
        require(quorum > 0 && sortedGuardianSignatures.length >= quorum, "no guardian quorum");

        require(block.number - lastDepositBlock >= minDepositBlockDistance, "too frequent deposits");
        require(blockHash != bytes32(0) && blockhash(blockNumber) == blockHash, "unexpected block hash");

        uint256 onchainKeysOpIndex = INodeOperatorsRegistry(nodeOperatorsRegistry).getKeysOpIndex();
        require(keysOpIndex == onchainKeysOpIndex, "keys op index changed");

        _verifySignatures(
            depositRoot,
            keysOpIndex,
            blockNumber,
            blockHash,
            sortedGuardianSignatures
        );

        ILido(LIDO).depositBufferedEther(maxDepositsPerBlock);
        lastDepositBlock = block.number;



                                                }
    

}