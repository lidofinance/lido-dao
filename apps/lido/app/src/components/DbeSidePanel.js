import { Button, GU, SidePanel, Info } from '@aragon/ui'
import React, { useCallback, useState } from 'react'

function PanelContent({ api, onClose }) {
  const [pending, setPending] = useState(false)

  const handleSubmit = useCallback(() => {
    api()
      .toPromise()
      .then(() => {
        setPending(false)
        onClose()
      })
      .catch(() => {
        setPending(false)
        onClose()
      })
  }, [api, onClose])

  return (
    <form
      css={`
        margin-top: ${3 * GU}px;
      `}
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
    >
      <Info
        title="Action"
        css={`
          margin-bottom: ${3 * GU}px;
        `}
      >
        This action will transfer all the buffered ether into the deposit.
      </Info>
      <Button
        mode="strong"
        disabled={pending}
        wide
        required
        label="Deposit"
        type="submit"
      />
    </form>
  )
}

export default (props) => (
  <SidePanel title="DEPOSIT BUFFERED ETHER" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
