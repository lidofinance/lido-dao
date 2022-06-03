import { useAppState } from '@aragon/api-react'
import { Box } from '@aragon/ui'
import React from 'react'
import { formatEth } from '../utils'
import { ListItem, LoadableElement } from './shared'

export const StakingLimitState = () => {
  const { stakingLimitInfo } = useAppState()

  return (
    <Box heading="Staking">
      <ListItem label="Paused">
        <LoadableElement value={stakingLimitInfo?.isStakingPaused}>
          {stakingLimitInfo?.isStakingPaused ? 'Yes' : 'No'}
        </LoadableElement>
      </ListItem>
      <ListItem label="Limit set">
        <LoadableElement value={stakingLimitInfo?.isStakingLimitSet}>
          {stakingLimitInfo?.isStakingLimitSet ? 'Yes' : 'No'}
        </LoadableElement>
      </ListItem>
      <ListItem label="Max limit">
        <LoadableElement value={stakingLimitInfo?.maxStakeLimit}>
          Ξ{formatEth(stakingLimitInfo?.maxStakeLimit)}
        </LoadableElement>
      </ListItem>
      <ListItem label="Restoration rate">
        <LoadableElement value={stakingLimitInfo?.maxStakeLimitGrowthBlocks}>
          {stakingLimitInfo?.maxStakeLimitGrowthBlocks} blocks
        </LoadableElement>
      </ListItem>
    </Box>
  )
}
