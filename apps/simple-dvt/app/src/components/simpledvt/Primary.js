import { useAppState } from '@aragon/api-react'
import React from 'react'
import { BoxUnpadded, ListItemUnformattedValue, NodeOperatorList } from '../shared'

export const SimpleDVTPrimary = () => {
    const {
        simpleDVT,
    } = useAppState()

    return (
        <>
            <BoxUnpadded heading="Summary">
                <ListItemUnformattedValue label="Nonce" value={simpleDVT?.nonce} />
                <ListItemUnformattedValue
                    label="Node operators"
                    value={simpleDVT?.nodeOperatorsCount}
                />
                <ListItemUnformattedValue
                    label="Active node operators"
                    value={simpleDVT?.activeNodeOperatorsCount}
                />
                <ListItemUnformattedValue
                    label="Depositable validators"
                    value={simpleDVT?.stakingModuleSummary?.depositableValidatorsCount}
                />
                <ListItemUnformattedValue
                    label="Deposited validators"
                    value={simpleDVT?.stakingModuleSummary?.totalDepositedValidators}
                />
                <ListItemUnformattedValue
                    label="Exited validators"
                    value={simpleDVT?.stakingModuleSummary?.totalExitedValidators}
                />
                <ListItemUnformattedValue
                    label="Stuck penalty delay"
                    value={simpleDVT?.stuckPenaltyDelay}
                />
            </BoxUnpadded>
            <NodeOperatorList />
        </>
    )
}
