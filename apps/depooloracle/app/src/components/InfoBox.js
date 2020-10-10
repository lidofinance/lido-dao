import { Box, Button } from '@aragon/ui'
import React from 'react'

export default function InfoBox({ heading, value, onClick, label }) {
  return (
    <Box heading={heading}>
      <p
        css={`
          font-size: 1.5rem;
          text-align: center;
          margin-bottom: 20px;
        `}
      >
        {value}
      </p>
      {onClick && <Button wide mode="strong" onClick={onClick} label={label} />}
    </Box>
  )
}
