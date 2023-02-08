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
      <div
        css={`
          font-size: ${largeText ? '1.5rem' : '1rem'};
          margin-bottom: ${onClick ? '20px' : '0px'};
          text-align: center;
        `}
      >
        {value}
      </div>
      {onClick && <Button wide mode="strong" onClick={onClick} label={label} />}
    </Box>
  )
}
