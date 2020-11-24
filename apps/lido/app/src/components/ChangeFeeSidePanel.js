import React, { useCallback } from 'react'
import { Button, GU, SidePanel, Info } from '@aragon/ui'
import * as yup from 'yup'
import { Formik, Field } from 'formik'
import TextField from './TextField'

const initialValues = {
  fee: 0,
}

const validationSchema = yup.object().shape({
  fee: yup
    .number()
    .positive()
    .required()
    .min(0)
    .max(100)
    .test(
      'fee',
      `Fee must be an integer or have 1 or 2 decimal places.`,
      (value) => {
        const regex = /^\d{1,3}(\.\d{1,2})?$/
        return regex.test(value)
      }
    ),
})

function Panel({ onClose, apiSetFee }) {
  const handleChangeFeeSubmit = useCallback(
    ({ fee }) => {
      apiSetFee(fee * 100)
        .catch(console.error)
        .finally(() => {
          onClose()
        })
    },
    [apiSetFee, onClose]
  )

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      validateOnBlur={false}
      validateOnChange={false}
      onSubmit={handleChangeFeeSubmit}
    >
      {({ submitForm, isSubmitting, isValidating }) => {
        return (
          <form
            css={`
              margin-top: ${3 * GU}px;
            `}
            onSubmit={(e) => {
              e.preventDefault()
              submitForm()
            }}
          >
            <Info
              title="Action"
              css={`
                margin-bottom: ${3 * GU}px;
              `}
            >
              This action will change the fee rate.
            </Info>
            <Field
              name="fee"
              type="number"
              label="Fee (%)"
              component={TextField}
            />
            <Button
              mode="strong"
              type="submit"
              disabled={isValidating || isSubmitting}
            >
              Set fee
            </Button>
          </form>
        )
      }}
    </Formik>
  )
}

export default function ChangeFeeSidePanel(props) {
  return (
    <SidePanel title="Change fee" {...props}>
      <Panel {...props} />
    </SidePanel>
  )
}
