import { useAppState } from '@aragon/api-react'
import { Box } from '@aragon/ui'
import React from 'react'
import { ListItem, LoadableElement, RestorationRate, Tooltip } from './shared'
import { Ether } from './shared/Ether'

export const StakingLimitState = () => {
  const { stakingLimitInfo } = useAppState()

  return (
    <Box heading="Staking status">
      <ListItem label="Paused">
        <LoadableElement value={stakingLimitInfo?.isStakingPaused}>
          {stakingLimitInfo?.isStakingPaused ? 'Yes' : 'No'}
        </LoadableElement>
      </ListItem>
      <ListItem
        label={
          <Tooltip tooltip="Staking limit is the total amount of ether that can be staked in a given block. The limit goes down with each deposit but is passively restored on each block.">
            Limit set
          </Tooltip>
        }
      >
        <LoadableElement value={stakingLimitInfo?.isStakingLimitSet}>
          {stakingLimitInfo?.isStakingLimitSet ? 'Yes' : 'No'}
        </LoadableElement>
      </ListItem>
      <ListItem
        label={
          <Tooltip tooltip="Hard cap on staking limit, i.e. staking limit will not be restored past this limit.">
            Max limit
          </Tooltip>
        }
      >
        <Ether ether={stakingLimitInfo?.maxStakeLimit} />
      </ListItem>
      <ListItem
        label={
          <Tooltip tooltip="Rate at which the staking limit is passively restored on each block up until the max limit if no deposits are submitted.">
            Restoration
          </Tooltip>
        }
      >
        <RestorationRate
          maxLimit={stakingLimitInfo?.maxStakeLimit}
          blocks={stakingLimitInfo?.maxStakeLimitGrowthBlocks}
        />
      </ListItem>
    </Box>
  )
}
