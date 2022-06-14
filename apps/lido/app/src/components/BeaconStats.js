import { useAppState } from '@aragon/api-react'
import { Box } from '@aragon/ui'
import React from 'react'
import { ListItem, LoadableElement } from './shared'
import { Ether } from './shared/Ether'

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
        <Ether ether={beaconStat?.beaconBalance} />
      </ListItem>
    </Box>
  )
}
