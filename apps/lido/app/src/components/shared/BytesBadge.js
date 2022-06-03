import { GU, textStyle } from '@aragon/ui'
import IconCheck from '@aragon/ui/dist/IconCheck'
import React, { useCallback, useEffect, useState } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard'
import styled from 'styled-components'

const BadgeStyle = styled.div`
  background: ${(props) => props.theme.badge};
  padding: 0px ${GU}px;
  border-radius: ${0.5 * GU}px;
  font-style: ${textStyle('address2')};
  &:hover {
    cursor: pointer;
  }
  display: flex;
  justify-content: space-between;
  align-items: center;
`

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
      <BadgeStyle>
        {copied && <IconCheck size="small" />}
        <BadgeText>{shortened}</BadgeText>
      </BadgeStyle>
    </CopyToClipboard>
  )
}
