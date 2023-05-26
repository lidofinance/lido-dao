import { useAppState } from '@aragon/api-react'
import React from 'react'
import { BoxUnpadded, ListItemUnformattedValue, NodeOperatorList } from '../shared'

export const CuratedPrimary = () => {
    const {
        curated,
    } = useAppState()

    return (
        <>
            <BoxUnpadded heading="Summary">
                <ListItemUnformattedValue label="Nonce" value={curated?.nonce} />
                <ListItemUnformattedValue
                    label="Node operators"
                    value={curated?.nodeOperatorsCount}
                />
                <ListItemUnformattedValue
                    label="Active node operators"
                    value={curated?.activeNodeOperatorsCount}
                />
                <ListItemUnformattedValue
                    label="Depositable validators"
                    value={curated?.stakingModuleSummary?.depositableValidatorsCount}
                />
                <ListItemUnformattedValue
                    label="Deposited validators"
                    value={curated?.stakingModuleSummary?.totalDepositedValidators}
                />
                <ListItemUnformattedValue
                    label="Exited validators"
                    value={curated?.stakingModuleSummary?.totalExitedValidators}
                />
                <ListItemUnformattedValue
                    label="Stuck penalty delay"
                    value={curated?.stuckPenaltyDelay}
                />
            </BoxUnpadded>
            <NodeOperatorList />
        </>
    )
}
