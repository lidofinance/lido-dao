import { Box, Button } from '@aragon/ui'
import React from 'react'

export default function InfoBox({
  heading,
  value,
  onClick,
  label,
  largeText = true,
}) {
  return (
    <Box heading={heading}>
      <p
        css={`
          font-size: ${largeText ? '1.5rem' : '1rem'};
          margin-bottom: ${largeText ? '20px' : '13px'};
          text-align: center;
        `}
      >
        {value}
      </p>
      {onClick && <Button wide mode="strong" onClick={onClick} label={label} />}
    </Box>
  )
}
