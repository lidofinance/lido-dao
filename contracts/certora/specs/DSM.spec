// import "../helpers/erc20.spec"
// import "../../src/bridge/Ibridge.sol"
using DepositSecurityModuleHarness as DSMH
methods{
getGuardianQuorum() returns (uint256) envfree
getGuardianLength() returns (uint256) envfree
}

// Rule and Invariants

rule  depositBufferEtherRevertCheck(){
        env e;
        bytes32 depositRoot;
        uint256 keysOpIndex;
        uint256 blockNumber;
        bytes32 blockHash;
        DSMH.Signature guardianSignature1;
        DSMH.Signature guardianSignature2;
        DSMH.Signature guardianSignature3;

        uint256 quorum;

        quorum = getGuardianQuorum();

        // callHelper();
        depositBufferedEtherHarness@withrevert(e, depositRoot,
                                        keysOpIndex,
                                        blockNumber,
                                        blockHash,
                                        guardianSignature1,
                                        guardianSignature2,
                                        guardianSignature3);

        assert !lastReverted;
        }

        invariant quorumLeGuardian(env e, method f)
        getGuardianLength() >= getGuardianQuorum()

        // rule quorumLeGuardian(env e, method f){
        //     uint256 quorum = getGuardianQuorum();
        //     uint256 guardianLength = getGuardianLength();

        //     calldataarg args;
        //     f(e, args);

        //     assert quorum <= guardianLength,"quorum cannot be greater than the number of guardians";
            
        // }

        function callHelper(){
        env e;
        bytes32 depositRoot;
        uint256 keysOpIndex;
        uint256 blockNumber;
        bytes32 blockHash;
        DSMH.Signature guardianSignature1;
        // DSMH.Signature guardianSignature2;
        // DSMH.Signature guardianSignature3;

        
        depositBufferedEther@withrevert(e, depositRoot,
                                        keysOpIndex,
                                        blockNumber,
                                        blockHash,
                                        formSignatureArray(e, guardianSignature1));
        }