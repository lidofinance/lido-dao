import { useAragonApi } from '@aragon/api-react'
import { Button, IconEdit, SidePanel } from '@aragon/ui'
import { Field, Form, Formik } from 'formik'
import React, { useState } from 'react'
import * as yup from 'yup'
import {
  BytesBadge,
  Controls,
  IconButton,
  InfoSpaced,
  ListItem,
  LoadableElement,
  TextField,
} from '../shared'

const fieldName = 'credentials'

const initialValues = {
  [fieldName]: '',
}

const validationSchema = yup.object().shape({
  credentials: yup
    .string('Credentials must be a string.')
    .test(
      fieldName,
      'Credentials must be a 32-byte hexadecimal number with `0x` prefix.',
      (credentials) => {
        const regex = /^0x[a-fA-F0-9]{64}$/
        return regex.test(credentials)
      }
    ),
})

export const WithdrawalCredentials = () => {
  const { api, appState } = useAragonApi()
  const { withdrawalCredentials } = appState

  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const openSidePanel = () => setSidePanelOpen(true)
  const closeSidePanel = () => setSidePanelOpen(false)

  const submit = ({ credentials }) => {
    api
      .setWithdrawalCredentials(credentials)
      .toPromise()
      .catch(console.error)
      .finally(closeSidePanel)
  }

  return (
    <ListItem label="Withdrawal Credentials">
      <Controls>
        <LoadableElement value={withdrawalCredentials}>
          <BytesBadge bytes={withdrawalCredentials} />
        </LoadableElement>
        <IconButton label="edit" icon={<IconEdit />} onClick={openSidePanel} />
      </Controls>
      <SidePanel
        opened={sidePanelOpen}
        title="Change Withdrawal Credentials"
        onClose={closeSidePanel}
      >
        <InfoSpaced title="Action">
          Set new withdrawal credentials. This action discards all unused
          signing keys as the signatures are invalidated.
        </InfoSpaced>
        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema}
          validateOnBlur={false}
          validateOnChange={false}
          onSubmit={submit}
        >
          {({ submitForm, isSubmitting, isValidating }) => {
            const handleSubmit = (event) => {
              event.preventDefault()
              submitForm()
            }

            return (
              <Form onSubmit={handleSubmit}>
                <Field
                  name={fieldName}
                  type="text"
                  label="Credentials"
                  component={TextField}
                />
                <Button
                  mode="strong"
                  wide
                  required
                  disabled={isValidating || isSubmitting}
                  label="Set withdrawal credentials"
                  type="submit"
                />
              </Form>
            )
          }}
        </Formik>
      </SidePanel>
    </ListItem>
  )
}
