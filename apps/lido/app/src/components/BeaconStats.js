import { useAppState } from '@aragon/api-react'
import { Box } from '@aragon/ui'
import { constants } from 'ethers'
import React from 'react'
import { formatEth } from '../utils'
import { ListItem, LoadableElement } from './shared'

export const BeaconStats = () => {
  const { beaconStat } = useAppState()

  return (
    <Box heading="Beacon stats">
      <ListItem label="Deposits">
        <LoadableElement value={beaconStat?.depositedValidators}>
          {beaconStat?.depositedValidators}
        </LoadableElement>
      </ListItem>
      <ListItem label="Balance">
        <LoadableElement value={beaconStat?.beaconBalance}>
          {constants.EtherSymbol}
          {formatEth(beaconStat?.beaconBalance)}
        </LoadableElement>
      </ListItem>
    </Box>
  )
}
