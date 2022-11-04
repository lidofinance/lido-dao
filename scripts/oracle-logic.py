#!/usr/bin/env python3

from typing import NamedTuple, List, TypedDict, Tuple, Dict
from enum import Enum
import math


def to_e18(x: int) -> int:
    return x * 10**18


TIMEOUT_FOR_EXIT_REQUEST = 72 * 60 * 60  # 72 hours
EXPECTED_VALIDATOR_BALANCE = to_e18(32)

# TODO
# Requests that came later than the oracle report block minus N blocks are carried over to the next round.
GAP_BEFORE_PROCESSING_WITHDRAWAL_REQUESTS = 123

StakingModuleId = int
NodeOperatorId = int
ValidatorPubKey = str


class FullNodeOperatorId(NamedTuple):
    staking_module_id: StakingModuleId
    node_operator_id: NodeOperatorId


class ValidatorKeyInfo(NamedTuple):
    staking_module_id: StakingModuleId
    node_operator_id: NodeOperatorId
    validator_pub_key: ValidatorPubKey


class RequestStatus(Enum):
    REQUESTED = 1
    VOLUNTARY_EXIT_SENT = 2
    EXITING = 3


class ExitRequestStatus(NamedTuple):
    request_params: ValidatorKeyInfo
    status: RequestStatus


class WithdrawalRequest(NamedTuple):
    block_number: int
    requested_ether: int
    shared_to_burn: int


class LidoOracleReportParams(NamedTuple):
    block_number: int

    total_lido_validators_balance: int

    """Withdrawal Credentials balance at `block_number`"""
    wc_contract_balance: int

    # TODO: Do we need it, why?
    number_of_lido_validators: int


class ValidatorExitBusContract:
    def reportKeysToEject(
        stakingModuleIds: List[StakingModuleId],
        nodeOperatorIds: List[NodeOperatorId],
        validatorPubkeys: List[ValidatorPubKey],
    ):
        pass


class WithdrawalQueueContract:
    def queue():
        pass

    def get_not_finalized_requests() -> List[WithdrawalRequest]:
        pass

    def finalize(lastIdToFinalize: int, etherToLock: int, totalPooledEther: int, totalShares: int):
        pass


class LidoContract:
    def balance() -> int:
        """Stub to return ether balance of the contract"""
        return 123

    def getBufferedEther() -> int:
        return 123


class LidoOracleContract:
    def reportBeacon(epochId: int, beaconBalance: int, beaconValidators: int):
        pass


class LidoExecutionLayerRewardsVault:
    @staticmethod
    def balance() -> int:
        pass


class WithdrawalCredentialsContract:
    def balance() -> int:
        pass


class GlobalCache(NamedTuple):
    last_requested_for_exit_validator_index: int

    # Is this needed?
    last_processed_withdrawal_request_id: int

    expecting_ether: int

    # All Lido validators sorted asc by activation time
    validators: List[ValidatorKeyInfo]


g_cache: GlobalCache

g_pending_exit_requests: List[ExitRequestStatus]


def get_block_of_last_reported_non_exited():
    # get back to past till the first Lido exited validator
    # iterate back to past over exit requests till
    # cannot go till the first exited because
    pass


def calc_number_of_not_reported_non_exited_validators():
    pass


def report_to_validator_exit_bus_contract(requests: List[ValidatorKeyInfo]):
    pass


def report_to_lido_oracle():
    pass


def report_to_lido_oracle_contract():
    pass


def get_non_finalized_withdrawal_requests() -> List[WithdrawalRequest]:
    # ready tail of non-finalized requests from WithdrawalQueueContract.queue()
    # and parse data to WithdrawalRequest
    pass


def get_last_validator_requested_to_exit():
    """To calc the value read blockchain back till the last ValidatorExitRequest event"""
    return g_cache.last_requested_for_exit_validator_index


def choose_next_validators_for_exit(num_validators: int) -> List[ValidatorKeyInfo]:
    # The simple algorithm is implemented here only, see post for the details
    # https://research.lido.fi/t/withdrawals-on-validator-exiting-order/3048/
    start = g_cache.last_requested_for_exit_validator_index
    return g_cache.validators[start : (start + num_validators)]


def get_ether_available_for_withdrawals():
    wc_balance = WithdrawalCredentialsContract.balance()
    el_rewards = LidoExecutionLayerRewardsVault.balance()
    deposit_buffer = LidoContract.getBufferedEther()
    # TODO: how the ether get transferred to WithdrawalQueue in time?

    # TODO: don't use deposit_buffer and el_rewards if slashings

    return wc_balance + el_rewards + deposit_buffer


def calc_number_of_validators_for_exit(ether_required: int) -> int:
    return math.ceil(ether_required / EXPECTED_VALIDATOR_BALANCE)


def get_pending_amount_of_ether():
    """Amount of ether expected to receiver after exits of the validators
    requested to exit. Does not count on ether from validators which didn't
    send VoluntaryExit requests before TIMEOUT_FOR_EXIT_REQUEST ended."""
    pass


def separate_requests_to_finalize(
    requests: List[WithdrawalRequest],
) -> Tuple[List[WithdrawalRequest], List[WithdrawalRequest]]:
    pass
    requests_to_finalize: List[WithdrawalRequest] = []
    ether_to_finalize = 0
    available_ether = get_ether_available_for_withdrawals()

    while len(requests) > 0:
        if ether_to_finalize + requests[0].requested_ether > available_ether:
            break
        ether_to_finalize += requests[0]
        requests_to_finalize.append(requests.pop(0))
    return requests_to_finalize, requests


def calc_amount_of_additional_ether_required_for_withdrawal_requests(
    requests: List[WithdrawalRequest],
    ether_for_finalization: int,
) -> int:
    available_ether = get_ether_available_for_withdrawals()
    expected_ether = get_pending_amount_of_ether()

    z = available_ether - ether_for_finalization + expected_ether
    pending_requests_ether = 0
    while len(requests) > 0:
        if requests[0].requested_ether + pending_requests_ether > z:
            break
        requests.pop(0)

    # at this point int `requests` there are only non-finalized requests
    # which require to request new validators to exit
    missing_ether = sum([_.requested_ether for _ in requests])
    return missing_ether


# Q: what price should be reported to WithdrawalQueue.finalize() ?

def main():
    requests = get_non_finalized_withdrawal_requests()
    requests_to_finalize, requests = separate_requests_to_finalize(requests)
    ether_for_finalization = sum([_.requested_ether for _ in requests_to_finalize])

    missing_ether = calc_amount_of_additional_ether_required_for_withdrawal_requests(
        requests, ether_for_finalization
    )
    num_validator_to_eject = calc_number_of_validators_for_exit(missing_ether)
    validators_to_eject = choose_next_validators_for_exit(num_validator_to_eject)
    report_to_validator_exit_bus_contract(validators_to_eject)
