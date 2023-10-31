import { Box } from '@aragon/ui'
import React from 'react'

export default function InfoBox({ heading, value }) {
  return (
    <Box heading={heading}>
      <p
        css={`
          font-size: 1.5rem;
          text-align: center;
        `}
      >
        {value}
      </p>
    </Box>
  )
}
