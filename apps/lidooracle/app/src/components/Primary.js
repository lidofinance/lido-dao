import { useAppState } from '@aragon/api-react'
import { DataView, IconConnect, IdentityBadge } from '@aragon/ui'
import React from 'react'
import { css } from 'styled-components'
import { BoxUnpadded, BytesBadge, Dot, ListItem, ListItemAddress, ListItemBoolean, ListItemTimestamp, ListItemUnformattedValue, LoadableElement } from './shared'

export const Primary = () => {
    const {
        reportVariants,
        consensusReport,
        reportProcessor,
        memberDetails,
        quorum,
        initialRefSlot,
        consensusVersion,
        consensusContract,
        lido
    } = useAppState()

    return (
        <>
            <BoxUnpadded heading="Consensus report">
                <ListItemUnformattedValue label="Reference slot" value={consensusReport?.refSlot} />
                <ListItemTimestamp label="Processing deadline" value={consensusReport?.processingDeadlineTime} />
                <ListItemBoolean label="Processing" value={consensusReport?.processingStarted} />
                <ListItem label="Hash">
                    <LoadableElement value={consensusReport?.hash}>
                        <BytesBadge bytes={consensusReport?.hash} />
                    </LoadableElement>
                </ListItem>
                <ListItemUnformattedValue label="Variants" value={reportVariants?.variants?.length} />
            </BoxUnpadded>
            <DataView
                fields={[
                    '',
                    'Members',
                    'Current Slot',
                    'Current Hash'
                ]}
                entries={memberDetails ?? []}
                renderEntry={(memberInfo) => [
                    <Dot id={memberInfo.address} active={memberInfo.canReport}>•</Dot>,
                    <><IdentityBadge entity={memberInfo?.address} /> {memberInfo?.isFastLane && <IconConnect css={css`color: ${props => props.theme.warning}`} />}</>,
                    memberInfo?.currentFrameRefSlot,
                    <BytesBadge bytes={memberInfo?.currentFrameMemberReport} />
                ]}
            />
            <BoxUnpadded heading="Settings">
                <ListItemUnformattedValue label="Members" value={memberDetails?.length} />
                <ListItemUnformattedValue label="Quorum" value={quorum} />
                <ListItemUnformattedValue label="Initial reference slot" value={initialRefSlot} />
                <ListItemUnformattedValue label="Consensus version" value={consensusVersion} />
                <ListItemAddress label="Processor" value={reportProcessor} />
                <ListItemAddress label="Consensus" value={consensusContract} />
                <ListItemAddress label="Lido" value={lido} />
            </BoxUnpadded>
        </>
    )
}
