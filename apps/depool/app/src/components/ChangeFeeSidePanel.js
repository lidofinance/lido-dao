import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  GU,
  SidePanel,
  Info,
  Field,
  TextInput,
  useSidePanel,
} from '@aragon/ui'

function Panel({ opened, onClose, apiSetFee }) {
  const inputRef = useRef()
  const { readyToFocus } = useSidePanel()

  useEffect(() => {
    if (readyToFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [readyToFocus, inputRef])

  const [pending, setPending] = useState(false)
  const [newFee, setNewFee] = useState(0)

  const onChangeNewFee = useCallback((event) => {
    setNewFee(+event.target.value)
  }, [])

  const handleChangeFeeSubmit = (event) => {
    event.preventDefault()
    setPending(true)
    apiSetFee(newFee)
      .toPromise()
      .then(() => {
        setNewFee(0)
        onClose()
        setPending(false)
      })
      .catch(() => {
        setNewFee(0)
        onClose()
        setPending(false)
      })
  }

  return (
    <form
      css={`
        margin-top: ${3 * GU}px;
      `}
      onSubmit={handleChangeFeeSubmit}
    >
      <Info
        title="Action"
        css={`
          margin-bottom: ${3 * GU}px;
        `}
      >
        This action will change the fee.
      </Info>
      <Field label="New fee value">
        <TextInput
          type="number"
          min={0}
          step="any"
          onChange={onChangeNewFee}
          required
          wide
          ref={inputRef}
        />
      </Field>
      <Button mode="strong" type="submit" disabled={pending}>
        Set fee
      </Button>
    </form>
  )
}

export default function ChangeFeeSidePanel(props) {
  return (
    <SidePanel title="Change fee" {...props}>
      <Panel {...props} />
    </SidePanel>
  )
}
