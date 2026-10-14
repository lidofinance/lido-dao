// SPDX-FileCopyrightText: 2026 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.25;

import {IAccessControl} from "@openzeppelin/contracts-v5.2/access/IAccessControl.sol";
import {Strings} from "@openzeppelin/contracts-v5.2/utils/Strings.sol";

import {ICircuitBreaker} from "contracts/common/interfaces/ICircuitBreaker.sol";
import {IOssifiableProxy} from "contracts/common/interfaces/IOssifiableProxy.sol";

import {IForwarder} from "../interfaces/IForwarder.sol";
import {CallsScriptBuilder} from "../utils/CallScriptBuilder.sol";
import {OmnibusBase} from "../utils/OmnibusBase.sol";

import {SRPhase2UpgradeConfig} from "./SRPhase2UpgradeConfig.sol";
import {SRPhase2UpgradeTemplate} from "./SRPhase2UpgradeTemplate.sol";
import {IWithdrawalsManagerProxy} from "./SRPhase2UpgradeTypes.sol";

/// @title SRPhase2UpgradeVoteScript
/// @notice Omnibus for the SR phase 2 (LIP-38) upgrade: replaces the TriggerableWithdrawalsGateway,
///         plugs in the TriggerableWithdrawalsBus and removes the exit delay penalties.
contract SRPhase2UpgradeVoteScript is OmnibusBase {
    using CallsScriptBuilder for CallsScriptBuilder.Context;
    using Strings for uint256;

    error InvalidItemsCount(uint256 actual, uint256 expected);

    uint256 public constant DG_ITEMS_COUNT = 1;
    uint256 public constant VOTING_ITEMS_COUNT = 0;
    uint256 public constant RAW_ACTIONS_COUNT = 14;

    bytes32 internal constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 internal constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 internal constant ADD_WITHDRAWAL_REQUEST_ROLE = keccak256("ADD_WITHDRAWAL_REQUEST_ROLE");
    bytes32 internal constant TW_EXIT_LIMIT_MANAGER_ROLE = keccak256("TW_EXIT_LIMIT_MANAGER_ROLE");
    bytes32 internal constant ADD_WITHDRAWAL_INTENTS_ROLE = keccak256("ADD_WITHDRAWAL_INTENTS_ROLE");
    bytes32 internal constant REPORT_VALIDATOR_EXIT_TRIGGERED_ROLE =
        keccak256("REPORT_VALIDATOR_EXIT_TRIGGERED_ROLE");
    bytes32 internal constant REPORT_VALIDATOR_EXITING_STATUS_ROLE =
        keccak256("REPORT_VALIDATOR_EXITING_STATUS_ROLE");

    address public immutable TEMPLATE;
    address public immutable CONFIG;
    address internal immutable AGENT;

    struct ScriptParams {
        address upgradeTemplate;
    }

    constructor(ScriptParams memory params)
        OmnibusBase(
            SRPhase2UpgradeConfig(SRPhase2UpgradeTemplate(params.upgradeTemplate).CONFIG()).VOTING(),
            SRPhase2UpgradeConfig(SRPhase2UpgradeTemplate(params.upgradeTemplate).CONFIG()).DUAL_GOVERNANCE()
        )
    {
        SRPhase2UpgradeTemplate template = SRPhase2UpgradeTemplate(params.upgradeTemplate);
        SRPhase2UpgradeConfig config = SRPhase2UpgradeConfig(template.CONFIG());
        TEMPLATE = address(template);
        CONFIG = address(config);
        AGENT = config.AGENT();
    }

    function getVotingVoteItems() public pure override returns (VoteItem[] memory items) {
        items = new VoteItem[](VOTING_ITEMS_COUNT);
    }

    function getVoteItemsRaw() external view returns (VoteItem[] memory) {
        VoteItem[] memory items = _getVoteItems();
        for (uint256 i = 0; i < items.length; ++i) {
            items[i].description = string.concat("1.", (i + 1).toString(), ". ", items[i].description);
        }
        return items;
    }

    function getVoteItems() public view override returns (VoteItem[] memory items) {
        VoteItem[] memory rawItems = _getVoteItems();
        CallsScriptBuilder.Context memory scriptBuilder = CallsScriptBuilder.create();
        for (uint256 i = 0; i < rawItems.length; ++i) {
            scriptBuilder.addCall(rawItems[i].call.to, rawItems[i].call.data);
        }

        items = new VoteItem[](DG_ITEMS_COUNT);
        items[0] = VoteItem({
            description: "1. Submit the SR phase 2 (LIP-38) upgrade to Dual Governance",
            call: _votingCall(AGENT, abi.encodeCall(IForwarder.forward, (scriptBuilder.getResult())))
        });
    }

    function _getVoteItems() internal view returns (VoteItem[] memory items) {
        SRPhase2UpgradeConfig config = SRPhase2UpgradeConfig(CONFIG);
        address newGateway = config.NEW_TRIGGERABLE_WITHDRAWALS_GATEWAY();
        address bus = config.TRIGGERABLE_WITHDRAWALS_BUS();

        items = new VoteItem[](RAW_ACTIONS_COUNT);
        uint256 i = 0;

        items[i++] = _item(
            "Call SRPhase2UpgradeTemplate.startUpgrade",
            TEMPLATE,
            abi.encodeCall(SRPhase2UpgradeTemplate.startUpgrade, ())
        );

        // --- Implementations behind proxies ---
        // The locator goes first, so every contract resolving the gateway or the bus through it sees the
        // new address book in the same transaction.
        items[i++] = _item(
            "Upgrade LidoLocator implementation",
            config.LOCATOR(),
            abi.encodeCall(IOssifiableProxy.proxy__upgradeTo, (config.NEW_LOCATOR_IMPLEMENTATION()))
        );
        // No setup calldata: the exit hooks are removed without a storage migration.
        items[i++] = _item(
            "Upgrade StakingRouter implementation",
            config.STAKING_ROUTER(),
            abi.encodeCall(IOssifiableProxy.proxy__upgradeTo, (config.NEW_STAKING_ROUTER_IMPL()))
        );
        // No setup calldata: only the TRIGGERABLE_WITHDRAWALS_GATEWAY immutable changes.
        items[i++] = _item(
            "Upgrade WithdrawalVault implementation",
            config.WITHDRAWAL_VAULT(),
            abi.encodeCall(IWithdrawalsManagerProxy.proxy_upgradeTo, (config.NEW_WITHDRAWAL_VAULT_IMPL(), ""))
        );

        // --- StakingRouter roles orphaned by the removed exit hooks ---
        items[i++] = _item(
            "Revoke REPORT_VALIDATOR_EXIT_TRIGGERED_ROLE from the old TriggerableWithdrawalsGateway",
            config.STAKING_ROUTER(),
            abi.encodeCall(
                IAccessControl.revokeRole,
                (REPORT_VALIDATOR_EXIT_TRIGGERED_ROLE, config.OLD_TRIGGERABLE_WITHDRAWALS_GATEWAY())
            )
        );
        items[i++] = _item(
            "Revoke REPORT_VALIDATOR_EXITING_STATUS_ROLE from the ValidatorExitDelayVerifier",
            config.STAKING_ROUTER(),
            abi.encodeCall(
                IAccessControl.revokeRole,
                (REPORT_VALIDATOR_EXITING_STATUS_ROLE, config.VALIDATOR_EXIT_DELAY_VERIFIER())
            )
        );

        // --- New TriggerableWithdrawalsGateway ---
        // DEFAULT_ADMIN_ROLE needs no item because the gateway is deployed with the Agent as its admin.
        items[i++] = _item(
            "Grant PAUSE_ROLE on the new TriggerableWithdrawalsGateway to the CircuitBreaker",
            newGateway,
            abi.encodeCall(IAccessControl.grantRole, (PAUSE_ROLE, config.CIRCUIT_BREAKER()))
        );
        items[i++] = _item(
            "Grant PAUSE_ROLE on the new TriggerableWithdrawalsGateway to the ResealManager",
            newGateway,
            abi.encodeCall(IAccessControl.grantRole, (PAUSE_ROLE, config.RESEAL_MANAGER()))
        );
        items[i++] = _item(
            "Grant RESUME_ROLE on the new TriggerableWithdrawalsGateway to the ResealManager",
            newGateway,
            abi.encodeCall(IAccessControl.grantRole, (RESUME_ROLE, config.RESEAL_MANAGER()))
        );
        items[i++] = _item(
            "Grant TW_EXIT_LIMIT_MANAGER_ROLE on the new TriggerableWithdrawalsGateway to the Agent",
            newGateway,
            abi.encodeCall(IAccessControl.grantRole, (TW_EXIT_LIMIT_MANAGER_ROLE, AGENT))
        );
        items[i++] = _item(
            "Grant ADD_WITHDRAWAL_REQUEST_ROLE on the new TriggerableWithdrawalsGateway to the TriggerableWithdrawalsBus",
            newGateway,
            abi.encodeCall(IAccessControl.grantRole, (ADD_WITHDRAWAL_REQUEST_ROLE, bus))
        );
        items[i++] = _item(
            "Register CircuitBreaker pauser for the new TriggerableWithdrawalsGateway",
            config.CIRCUIT_BREAKER(),
            abi.encodeCall(ICircuitBreaker.registerPauser, (newGateway, config.CIRCUIT_BREAKER_COMMITTEE()))
        );

        // --- TriggerableWithdrawalsBus ---
        items[i++] = _item(
            "Grant ADD_WITHDRAWAL_INTENTS_ROLE on the TriggerableWithdrawalsBus to the ValidatorsExitBusOracle",
            bus,
            abi.encodeCall(IAccessControl.grantRole, (ADD_WITHDRAWAL_INTENTS_ROLE, config.VALIDATORS_EXIT_BUS_ORACLE()))
        );

        items[i++] = _item(
            "Call SRPhase2UpgradeTemplate.finishUpgrade",
            TEMPLATE,
            abi.encodeCall(SRPhase2UpgradeTemplate.finishUpgrade, ())
        );

        if (i != RAW_ACTIONS_COUNT) revert InvalidItemsCount(i, RAW_ACTIONS_COUNT);
    }

    function _item(string memory description, address to, bytes memory data) private pure returns (VoteItem memory) {
        return VoteItem({description: description, call: _votingCall(to, data)});
    }
}
