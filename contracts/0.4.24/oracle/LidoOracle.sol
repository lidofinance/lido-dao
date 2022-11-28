// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/introspection/ERC165Checker.sol";

import "../interfaces/IBeaconReportReceiver.sol";
import "../interfaces/ILido.sol";
import "../interfaces/ILidoOracle.sol";



/**
 * @title TODO
 *
 * TODO
 */
contract LidoOracle is ILidoOracle, AragonApp {
    using SafeMath for uint256;
    using ERC165Checker for address;


    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION =
        0x75be19a3f314d89bd1f84d30a6c84e2f1cd7afc7b6ca21876564c265113bb7e4; // keccak256("lido.LidoOracle.contractVersion")

    /// Historic data about 2 last completed reports and their times
    bytes32 internal constant POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0xaa8433b13d2b111d4f84f6f374bc7acbe20794944308876aa250fa9a73dc7f53; // keccak256("lido.LidoOracle.postCompletedTotalPooledEther")
    bytes32 internal constant PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0x1043177539af09a67d747435df3ff1155a64cd93a347daaac9132a591442d43e; // keccak256("lido.LidoOracle.preCompletedTotalPooledEther")
    bytes32 internal constant LAST_COMPLETED_EPOCH_ID_POSITION =
        0xdad15c0beecd15610092d84427258e369d2582df22869138b4c5265f049f574c; // keccak256("lido.LidoOracle.lastCompletedEpochId")
    bytes32 internal constant TIME_ELAPSED_POSITION =
        0x8fe323f4ecd3bf0497252a90142003855cc5125cee76a5b5ba5d508c7ec28c3a; // keccak256("lido.LidoOracle.timeElapsed")

    /// This is a dead variable: it was used only in v1 and in upgrade v1 --> v2
    /// Just keep in mind that storage at this position is occupied but with no actual usage
    bytes32 internal constant V1_LAST_REPORTED_EPOCH_ID_POSITION =
        0xfe0250ed0c5d8af6526c6d133fccb8e5a55dd6b1aa6696ed0c327f8e517b5a94; // keccak256("lido.LidoOracle.lastReportedEpochId")

    /**
     * @notice Report total pooled ether and its change during the last frame
     */
    function getLastCompletedReportDelta()
        external
        view
        returns (
            uint256 postTotalPooledEther,
            uint256 preTotalPooledEther,
            uint256 timeElapsed
        )
    {
        postTotalPooledEther = POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.getStorageUint256();
        preTotalPooledEther = PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.getStorageUint256();
        timeElapsed = TIME_ELAPSED_POSITION.getStorageUint256();
    }


    /**
     * @notice Return the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }


    // /**
    //  * @notice A function to finalize upgrade to v3 (from v1). Can be called only once
    //  * @dev Value 2 in CONTRACT_VERSION_POSITION is skipped due to change in numbering
    //  * For more details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
    //  */
    // function finalizeUpgrade_v3() external {
    //     require(CONTRACT_VERSION_POSITION.getStorageUint256() == 1, "WRONG_BASE_VERSION");

    //     _initialize_v3();

    //     // TODO: update to 4th version?
    // }

    // /**
    //  * @notice A dummy incremental v1/v2 --> v3 initialize function. Just corrects version number in storage
    //  * @dev This function is introduced just to set in correspondence version number in storage,
    //  * semantic version of the contract and number N used in naming of _initialize_nN/finalizeUpgrade_vN.
    //  * NB, that thus version 2 is skipped
    //  */
    // function _initialize_v3() internal {
    //     CONTRACT_VERSION_POSITION.setStorageUint256(3);
    //     emit ContractVersionSet(3);
    // }

    /**
     * @notice Return the current timestamp
     */
    function _getTime() internal view returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }

}
