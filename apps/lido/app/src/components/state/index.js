import { Box } from '@aragon/ui'
import React from 'react'
import { BufferedEther } from './BufferedEther'
import { DepositContract } from './DepositContract'
import { ElRewardsVault } from './ElRewardsVault'
import { ElRewardsWithdrawalLimit } from './ElRewardsWithdrawalLimit'
import { Fee } from './Fee'
import { FeeDistribution } from './FeeDistribution'
import { NodeOperatorsRegistry } from './NodeOperatorsRegistry'
import { Oracle } from './Oracle'
import { Status } from './Status'
import { TotalPooledEther } from './TotalPooledEther'
import { WithdrawalCredentials } from './WithdrawalCredentials'

export const State = () => {
  return (
    <Box heading="State">
      <Status />
      <Fee />
      <FeeDistribution />
      <WithdrawalCredentials />
      <ElRewardsWithdrawalLimit />
      <ElRewardsVault />
      <BufferedEther />
      <TotalPooledEther />
      <DepositContract />
      <NodeOperatorsRegistry />
      <Oracle />
    </Box>
  )
}
