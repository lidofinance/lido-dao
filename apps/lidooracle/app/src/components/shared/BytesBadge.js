import { GU, textStyle } from '@aragon/ui'
import BadgeBase from '@aragon/ui/dist/BadgeBase'
import IconCheck from '@aragon/ui/dist/IconCheck'
import React, { useCallback, useEffect, useState } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard'
import styled from 'styled-components'

const BadgeText = styled.span`
  margin-left: ${0.5 * GU}px;
`

export const BytesBadge = ({ bytes }) => {
  const shortened =
    typeof bytes === 'string'
      ? `${bytes.substring(0, 6)}…${bytes.substring(60)}`
      : ''

  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => setCopied(true), [])

  useEffect(() => {
    let interval
    if (copied) {
      interval = setInterval(() => {
        setCopied(false)
      }, 3000)
    }

    return () => clearInterval(interval)
  }, [copied])

  return (
    <CopyToClipboard text={bytes} onCopy={handleCopy}>
      <BadgeBase
        label={
          <>
            {copied && <IconCheck size="small" />}
            <BadgeText>{shortened}</BadgeText>
          </>
        }
      />
    </CopyToClipboard>
  )
}
