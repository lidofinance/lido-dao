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

function Panel({ onClose, apiSetWC }) {
  const inputRef = useRef()
  const { readyToFocus } = useSidePanel()

  useEffect(() => {
    if (readyToFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [readyToFocus, inputRef])

  const [pending, setPending] = useState(false)
  const [newWC, setNewWC] = useState('')

  const onChangeNewWC = useCallback((event) => {
    setNewWC(event.target.value)
  }, [])

  const handleChangeWCSubmit = (event) => {
    event.preventDefault()
    setPending(true)
    apiSetWC(newWC)
      .toPromise()
      .then(() => {
        setNewWC('')
        onClose()
        setPending(false)
      })
      .catch(() => {
        setNewWC('')
        onClose()
        setPending(false)
      })
  }

  return (
    <form
      css={`
        margin-top: ${3 * GU}px;
      `}
      onSubmit={handleChangeWCSubmit}
    >
      <Info
        title="Action"
        css={`
          margin-bottom: ${3 * GU}px;
        `}
      >
        This action will change the withdrawal credentials.
      </Info>
      <Field label="New withdrawal credentials">
        <TextInput type="text" onChange={onChangeNewWC} required wide />
      </Field>
      <Button mode="strong" type="submit" disabled={pending}>
        Set withdrawal credentials
      </Button>
    </form>
  )
}

export default function ChangeWCSidePanel(props) {
  return (
    <SidePanel title="Change withdrawal credentials" {...props}>
      <Panel {...props} />
    </SidePanel>
  )
}
