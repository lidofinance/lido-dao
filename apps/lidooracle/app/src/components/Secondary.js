import { useAppState } from '@aragon/api-react'
import React from 'react'
import { BoxUnpadded, BytesBadge, ListItem, ListItemBoolean, ListItemTimestamp, ListItemUnformattedValue, LoadableElement } from './shared'

export const Secondary = () => {
    const {
        chainConfig,
        frameConfig
    } = useAppState()

    return (
        <>
            <BoxUnpadded heading="Chain config">
                <ListItemTimestamp label="Genesis" value={chainConfig?.genesisTime} />
                <ListItemUnformattedValue label="Seconds per slot" value={chainConfig?.secondsPerSlot} />
                <ListItemUnformattedValue label="Slots per epoch" value={chainConfig?.slotsPerEpoch} />
            </BoxUnpadded>
            <BoxUnpadded heading="Frame config">
                <ListItemUnformattedValue label="Initial epoch" value={frameConfig?.initialEpoch} />
                <ListItemUnformattedValue label="Epochs per frame" value={frameConfig?.epochsPerFrame} />
                <ListItemUnformattedValue label="Fastlane slots" value={frameConfig?.fastLaneLengthSlots} />
            </BoxUnpadded>
        </>
    )
}
