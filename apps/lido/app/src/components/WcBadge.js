import React, { useCallback, useEffect, useState } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard'
import { GU, useTheme, textStyle } from '@aragon/ui'
import IconCheck from '@aragon/ui/dist/IconCheck'

export default function WcBadge({ wc }) {
  const theme = useTheme()
  const shortened = `${wc.substring(0, 6)}…${wc.substring(62)}`

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
    <CopyToClipboard text={wc} onCopy={handleCopy}>
      <div
        css={`
          background: ${theme.badge};
          padding: 0px ${GU}px;
          border-radius: ${0.5 * GU}px;
          font-style: ${textStyle('address2')};
          &:hover {
            cursor: pointer;
          }
          display: flex;
          justify-content: space-between;
          align-items: center;
        `}
      >
        {copied && <IconCheck size="small" />}
        <span
          css={`
            margin-left: ${0.5 * GU}px;
          `}
        >
          {shortened}
        </span>
      </div>
    </CopyToClipboard>
  )
}
