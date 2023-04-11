import json
import fileinput

# Define the input and output file paths
input_file = ''
output_file = ''

def get_json_value(path, data):
    for k in path.split('/'):
        data = data[k]
    return data


# Define the dictionary mapping input keys to output keys
key_mapping = {
    'lido_dao_lido_locator': 'lidoLocator/address',
    'lido_dao_burner': 'burner/address',
    'lido_dao_hash_consensus_for_accounting_oracle': 'hashConsensusForAccounting/address',
    'lido_dao_accounting_oracle': 'accountingOracle/address',
    'lido_dao_hash_consensus_for_validators_exit_bus_oracle': 'hashConsensusForValidatorsExitBus/address',
    'lido_dao_validators_exit_bus_oracle': 'validatorsExitBusOracle/address',
    'lido_dao_oracle_report_sanity_checker': 'oracleReportSanityChecker/address',
    'lido_dao_withdrawal_queue': 'withdrawalQueueERC721/address',
    'lido_dao_eip712_steth': 'eip712StETH/address',
    'lido_dao_staking_router': 'stakingRouter/address',
    # 'gate_seal': '',
    'oracle_daemon_config': 'oracleDaemonConfig/address',
    'deployer_eoa': 'deployerEOA',
    'lido_dao_lido_locator_implementation': 'lidoLocator/implementation',
    'lido_dao_deposit_security_module_address': 'depositSecurityModule/address',
    'lido_dao_accounting_oracle_implementation': 'accountingOracle/implementation',
    'lido_dao_deposit_security_module_address_old': 'depositorPreviousAddress',
    'lido_dao_withdrawal_vault_implementation': 'withdrawalVault/implementation',
}

# Read the data from the input JSON file
with open(input_file) as f:
    data = json.load(f)

replacements_counter = 0
# Iterate over the lines of the output file and replace the values of the specified keys
for line in fileinput.input(output_file, inplace=True):
    for config_key, json_key in key_mapping.items():
        if line.startswith(f"{config_key} = "):
            value = get_json_value(json_key, data)
            line = f'{config_key} = "{value}"\n'
            replacements_counter += 1
    print(line, end='')

print(f"Values replaced: {replacements_counter}")
