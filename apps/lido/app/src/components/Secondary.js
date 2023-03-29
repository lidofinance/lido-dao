import { useAppState, useAragonApi } from '@aragon/api-react'
import React from 'react'
import {
    BoxUnpadded, ListItem,
    ListItemAddress, ListItemBoolean,
    ListItemEther,
    ListItemUnformattedValue,
    LoadableElement,
    RestorationRate,
    Tooltip,
    Ether
} from './shared'

export const Secondary = () => {
    const { lido, symbol, decimals, totalSupply, stakeLimitFullInfo, hasInitialized, initializationBlock, contractVersion } = useAppState()

    return (
        <>
            <BoxUnpadded heading="Token">
                <ListItemUnformattedValue label="Symbol" value={symbol} />
                <ListItemUnformattedValue label="Decimals" value={decimals} />
                <ListItemEther
                    label="Total supply"
                    value={totalSupply}
                    symbol={symbol}
                    symbolAfter
                />
                <ListItemAddress label="Address" value={lido} />
            </BoxUnpadded>
            <BoxUnpadded heading="Staking status">
                <ListItem label="Paused">
                    <LoadableElement value={stakeLimitFullInfo?.isStakingPaused}>
                        {stakeLimitFullInfo?.isStakingPaused ? 'Yes' : 'No'}
                    </LoadableElement>
                </ListItem>
                <ListItem
                    label={
                        <Tooltip tooltip="Staking limit is the total amount of ether that can be staked in a given block. The limit goes down with each deposit but is passively restored on each block.">
                            Limit set
                        </Tooltip>
                    }
                >
                    <LoadableElement value={stakeLimitFullInfo?.isStakingLimitSet}>
                        {stakeLimitFullInfo?.isStakingLimitSet ? 'Yes' : 'No'}
                    </LoadableElement>
                </ListItem>
                <ListItem
                    label={
                        <Tooltip tooltip="Hard cap on staking limit, i.e. staking limit will not be restored past this limit.">
                            Max limit
                        </Tooltip>
                    }
                >
                    <LoadableElement value={stakeLimitFullInfo?.maxStakeLimit}>
                        <Ether ether={stakeLimitFullInfo?.maxStakeLimit} />
                    </LoadableElement>
                </ListItem>
                <ListItem
                    label={
                        <Tooltip tooltip="Rate at which the staking limit is passively restored on each block up until the max limit if no user funds are submitted.">
                            Restoration
                        </Tooltip>
                    }
                >
                    <RestorationRate
                        maxLimit={stakeLimitFullInfo?.maxStakeLimit}
                        blocks={stakeLimitFullInfo?.maxStakeLimitGrowthBlocks}
                    />
                </ListItem>
            </BoxUnpadded>
            <BoxUnpadded heading="Meta">
                <ListItemBoolean label="Initialized" value={hasInitialized} />
                <ListItemUnformattedValue
                    label="Init block"
                    value={initializationBlock}
                />
                <ListItemUnformattedValue label="Lido version" value={contractVersion} />
            </BoxUnpadded>
        </>
    )
}
