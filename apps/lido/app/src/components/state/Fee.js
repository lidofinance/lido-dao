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

export const Fee = () => {
  const { api } = useAragonApi()
  const { fee } = useAppState()

  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const openSidePanel = () => setSidePanelOpen(true)
  const closeSidePanel = () => setSidePanelOpen(false)

  const submit = ({ fee }) => {
    api
      .setFee(toBasisPoints(fee))
      .toPromise()
      .catch(console.error)
      .finally(closeSidePanel)
  }

  return (
    <ListItem label="Fee">
      <Controls>
        <BasisPoints basisPoints={fee} />
        <IconButton label="edit" icon={<IconEdit />} onClick={openSidePanel} />
      </Controls>
      <SidePanel
        opened={sidePanelOpen}
        title="Change fee"
        onClose={closeSidePanel}
      >
        <InfoSpaced title="Action">
          Adjust the fee applied on staking rewards.
        </InfoSpaced>
        <Formik
          initialValues={{
            fee: '',
          }}
          validationSchema={yup.object().shape({
            fee: yup
              .number('Fee must be a number.')
              .required('Fee must be a valid number.')
              .min(0, 'Fee must be greater than or equal zero.')
              .max(100, 'Fee must be less than or equal 100. ')
              .test(
                'fee',
                'Fee must a number with up to 2 optional decimal places.',
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
                  name="fee"
                  type="number"
                  label="Fee (%)"
                  component={TextField}
                />
                <Button
                  mode="strong"
                  wide
                  required
                  disabled={isValidating || isSubmitting}
                  label="Set fee"
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
