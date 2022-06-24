import { useAppState, useAragonApi } from '@aragon/api-react'
import { Button, IconEdit, SidePanel } from '@aragon/ui'
import { Field, Form, Formik } from 'formik'
import React, { useState } from 'react'
import * as yup from 'yup'

import {
  Controls,
  IconButton,
  InfoSpaced,
  ListItem,
  TextField,
} from '../shared'
import { toBasisPoints } from '../../utils'
import { BasisPoints } from '../shared/BasisPoints'

export const ElRewardsWithdrawalLimit = () => {
  const { api } = useAragonApi()
  const { elRewardsWithdrawalLimit } = useAppState()

  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const openSidePanel = () => setSidePanelOpen(true)
  const closeSidePanel = () => setSidePanelOpen(false)

  const submit = ({ limit }) => {
    api
      .setELRewardsWithdrawalLimit(toBasisPoints(limit))
      .toPromise()
      .catch(console.error)
      .finally(closeSidePanel)
  }

  return (
    <ListItem label="EL Rewards Withdrawal Limit">
      <Controls>
        <BasisPoints basisPoints={elRewardsWithdrawalLimit} />
        <IconButton label="edit" icon={<IconEdit />} onClick={openSidePanel} />
      </Controls>
      <SidePanel
        opened={sidePanelOpen}
        title="Change EL Rewards Withdrawal Limit"
        onClose={closeSidePanel}
      >
        <InfoSpaced title="Action">
          Adjust the limit on withdrawable ether from execution layer rewards
          vault per oracle report.
        </InfoSpaced>
        <Formik
          initialValues={{
            limit: '',
          }}
          validationSchema={yup.object().shape({
            limit: yup
              .number('Limit must be a number.')
              .required('Limit must be a valid number.')
              .min(0, 'Limit must be greater than or equal zero.')
              .max(100, 'Limit must be less than or equal 100. ')
              .test(
                'limit',
                'Limit must a number with up to 2 optional decimal places.',
                (value) => {
                  const regex = /^\d{1,3}(\.\d{1,2})?$/
                  return regex.test(value)
                }
              ),
          })}
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
                  name="limit"
                  type="number"
                  label="Limit (%)"
                  component={TextField}
                />
                <Button
                  mode="strong"
                  wide
                  required
                  disabled={isValidating || isSubmitting}
                  label="Set limit"
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
