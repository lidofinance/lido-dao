import { useAppState } from '@aragon/api-react'
import { DataView, IdentityBadge } from '@aragon/ui'
import React from 'react'
import { BasisPoints, BoxUnpadded, ListItemAddress, ListItemBasisPoints, ListItemBytes, ListItemUnformattedValue, Tooltip } from '../shared'


export const StakingRouterPrimary = () => {
    const {
        stakingRouter,
    } = useAppState()

    return (
        <>
            <BoxUnpadded heading="Global digest">
                <ListItemUnformattedValue label="Staking modules" value={stakingRouter?.globalDigest?.stakingModulesCount} />
                <ListItemUnformattedValue label="Operators" value={stakingRouter?.globalDigest?.nodeOperatorsCount} />
                <ListItemUnformattedValue label="Active operators" value={stakingRouter?.globalDigest?.activeNodeOperatorsCount} />
                <ListItemUnformattedValue label="Depositable validators" value={stakingRouter?.globalDigest?.depositableValidatorsCount} />
                <ListItemUnformattedValue label="Exited validators" value={stakingRouter?.globalDigest?.exitedValidatorsCount} />
                <ListItemBasisPoints label="Protocol fee" value={stakingRouter?.totalFeeE4Precision} />
                <ListItemBasisPoints nested label="Modules fee" value={stakingRouter?.stakingFeeAggregateDistribution?.modulesFee / stakingRouter?.stakingFeeAggregateDistribution?.basePrecision * stakingRouter?.totalBasisPoints} />
                <ListItemBasisPoints nested label="Treasury fee" value={stakingRouter?.stakingFeeAggregateDistribution.treasuryFee / stakingRouter?.stakingFeeAggregateDistribution?.basePrecision * stakingRouter?.totalBasisPoints} />
            </BoxUnpadded>
            <DataView
                fields={[
                    'Id',
                    'Module name',
                    'Status',
                    'Target share',
                    <Tooltip tooltip="Module fee / Treasury fee">Fees</Tooltip>,
                    <Tooltip tooltip="Active / Total">NOs</Tooltip>,
                    <Tooltip tooltip="Depositable / Deposited / Exited">Validators</Tooltip>,
                ]}
                entries={stakingRouter?.allStakingModuleDigests ?? []}
                renderEntry={(digest) => [
                    digest.state.id,
                    <IdentityBadge entity={digest.state.stakingModuleAddress} label={digest.state.name} />,
                    statuses[digest.state.status],
                    <BasisPoints basisPoints={digest.state.targetShare} />,
                    <>
                        <BasisPoints basisPoints={digest.state.stakingModuleFee} />/
                        <BasisPoints basisPoints={digest.state.treasuryFee} />
                    </>,
                    digest.activeNodeOperatorsCount + "/" + digest.nodeOperatorsCount,
                    digest.summary.depositableValidatorsCount + "/" + digest.summary.totalDepositedValidators + "/" + digest.summary.totalExitedValidators
                ]}
            />
            <BoxUnpadded heading="Config">
                <ListItemUnformattedValue label="Max staking modules" value={stakingRouter?.maxStakingModulesCount} />
                <ListItemAddress label="Lido" value={stakingRouter?.lido} />
                <ListItemAddress label="DepositContract" value={stakingRouter?.depositContract} />
                <ListItemBytes label="Withdrawal credentials" value={stakingRouter?.withdrawalCredentials} />
            </BoxUnpadded>

        </>
    )
}

const statuses = ["Active", "Deposits paused", "Stopped"]
