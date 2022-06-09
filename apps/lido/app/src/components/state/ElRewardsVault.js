import { useAppState, useAragonApi } from '@aragon/api-react'
import { Button, IconEdit, IdentityBadge, SidePanel } from '@aragon/ui'
import { Field, Form, Formik } from 'formik'
import React, { useState } from 'react'
import {
  Controls,
  IconButton,
  InfoSpaced,
  ListItem,
  LoadableElement,
  TextField,
} from '../shared'
import * as yup from 'yup'
import { isAddress } from 'web3-utils'

const fieldName = 'vault'

const initialValues = {
  [fieldName]: '',
}

const validationSchema = yup.object().shape({
  vault: yup
    .string('Vault must be a string.')
    .test(fieldName, 'Vault must be a valid address.', (vault) => {
      return isAddress(vault)
    }),
})

export const ElRewardsVault = () => {
  const { api } = useAragonApi()
  const { elRewardsVault } = useAppState()

  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const openSidePanel = () => setSidePanelOpen(true)
  const closeSidePanel = () => setSidePanelOpen(false)

  const submit = ({ vault }) => {
    api
      .setELRewardsVault(vault)
      .toPromise()
      .catch(console.error)
      .finally(closeSidePanel)
  }

  return (
    <ListItem label="EL Rewards Vault">
      <Controls>
        <LoadableElement value={elRewardsVault}>
          <IdentityBadge entity={elRewardsVault} />
        </LoadableElement>
        <IconButton label="edit" icon={<IconEdit />} onClick={openSidePanel} />
      </Controls>
      <SidePanel
        opened={sidePanelOpen}
        title="Change EL Rewards Vault"
        onClose={closeSidePanel}
      >
        <InfoSpaced title="Action">
          Set a new address for the execution layer rewards vault contract.
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
                  label="Vault"
                  component={TextField}
                />
                <Button
                  mode="strong"
                  wide
                  required
                  disabled={isValidating || isSubmitting}
                  label="Set EL rewards vault"
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
