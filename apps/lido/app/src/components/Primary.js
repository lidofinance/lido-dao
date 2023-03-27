import { useAppState } from '@aragon/api-react'
import React from 'react'
import {
    BoxUnpadded,
    BytesBadge,
    ListItem,
    ListItemAddress,
    ListItemBasisPoints,
    ListItemBoolean,
    ListItemEther,
    ListItemUnformattedValue,
    LoadableElement
} from './shared'

export const Primary = () => {
    const {
        isStopped,
        canDeposit,
        bufferedEther,
        depositableEther,
        totalPooledEther,
        totalELRewardsCollected,
        beaconStat,
        fee,
        feeDistribution,
        withdrawalCredentials,
        treasury,
        legacyOracle,
        recoveryVault,
        lidoLocator,
    } = useAppState()

    return (
        <>
            <BoxUnpadded heading="State">
                <ListItemBoolean label="Status" value={!isStopped} renderElements={["Active", "Stopped"]} />
                <ListItemBoolean label="Deposits" value={canDeposit} renderElements={["Enabled", "Disabled"]} />
                <ListItemEther label="Ether buffered" value={bufferedEther} />
                <ListItemEther label="Ether depositable" value={depositableEther} />
                <ListItemEther label="Ether pooled, total" value={totalPooledEther} />
                <ListItemEther
                    label="EL rewards collected, total"
                    value={totalELRewardsCollected}
                />
            </BoxUnpadded>
            <BoxUnpadded heading="Consensus layer">
                <ListItemEther
                    label="Cumulative validator balance"
                    value={beaconStat?.beaconBalance}
                />
                <ListItemUnformattedValue
                    label="Deposited validators"
                    value={beaconStat?.depositedValidators}
                />
                <ListItemUnformattedValue
                    label="Validators, total"
                    value={beaconStat?.beaconValidators}
                />
            </BoxUnpadded>
            <BoxUnpadded heading="Configuration">
                <ListItemBasisPoints label="Protocol fee" value={fee} />
                <ListItem label="Protocol fee distribution" noBorder />
                <ListItemBasisPoints
                    label="Treasury"
                    value={feeDistribution?.treasuryFeeBasisPoints}
                    nested
                />
                <ListItemBasisPoints
                    label="Insurance"
                    value={feeDistribution?.insuranceFeeBasisPoints}
                    nested
                />
                <ListItemBasisPoints
                    label="Operators"
                    value={feeDistribution?.operatorsFeeBasisPoints}
                    nested
                />
                <ListItem label="Withdrawal credentials">
                    <LoadableElement value={withdrawalCredentials}>
                        <BytesBadge bytes={withdrawalCredentials} />
                    </LoadableElement>
                </ListItem>
            </BoxUnpadded>
            <BoxUnpadded heading="Locations">
                <ListItemAddress label="Treasury" value={treasury} />
                <ListItemAddress label="Oracle (legacy)" value={legacyOracle} />
                <ListItemAddress label="Recovery vault" value={recoveryVault} />
                <ListItemAddress label="Locator" value={lidoLocator} />
            </BoxUnpadded>
        </>
    )
}
