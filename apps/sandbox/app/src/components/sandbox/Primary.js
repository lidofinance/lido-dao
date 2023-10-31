import { useAppState } from '@aragon/api-react'
import React from 'react'
import { BoxUnpadded, ListItemUnformattedValue, NodeOperatorList } from '../shared'

export const SandBoxPrimary = () => {
    const {
        sandbox,
    } = useAppState()

    return (
        <>
            <BoxUnpadded heading="Summary">
                <ListItemUnformattedValue label="Nonce" value={sandbox?.nonce} />
                <ListItemUnformattedValue
                    label="Node operators"
                    value={sandbox?.nodeOperatorsCount}
                />
                <ListItemUnformattedValue
                    label="Active node operators"
                    value={sandbox?.activeNodeOperatorsCount}
                />
                <ListItemUnformattedValue
                    label="Depositable validators"
                    value={sandbox?.stakingModuleSummary?.depositableValidatorsCount}
                />
                <ListItemUnformattedValue
                    label="Deposited validators"
                    value={sandbox?.stakingModuleSummary?.totalDepositedValidators}
                />
                <ListItemUnformattedValue
                    label="Exited validators"
                    value={sandbox?.stakingModuleSummary?.totalExitedValidators}
                />
                <ListItemUnformattedValue
                    label="Stuck penalty delay"
                    value={sandbox?.stuckPenaltyDelay}
                />
            </BoxUnpadded>
            <NodeOperatorList />
        </>
    )
}
