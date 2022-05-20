import React, { useCallback } from 'react'
import { Button, GU, SidePanel, Info } from '@aragon/ui'
import * as yup from 'yup'
import { Formik, Field } from 'formik'
import TextField from './TextField'

const initialValues = {
  limit: '',
}

const validationSchema = yup.object().shape({
  limit: yup
    .number()
    .positive()
    .required()
    .min(0)
    .max(100)
    .test(
      'limit',
      `Limit must be a number with up to 2 optional decimal places.`,
      (value) => {
        const regex = /^\d{1,3}(\.\d{1,2})?$/
        return regex.test(value)
      }
    ),
})

function Panel({ onClose, api }) {
  const handleChangeLimitSubmit = useCallback(
    ({ limit }) => {
      api(limit * 100)
        .catch(console.error)
        .finally(() => {
          onClose()
        })
    },
    [api, onClose]
  )

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      validateOnBlur={false}
      validateOnChange={false}
      onSubmit={handleChangeLimitSubmit}
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
              This action will change the execution layer rewards withdrawal
              limit.
            </Info>
            <Field
              name="limit"
              type="number"
              label="Limit (%)"
              component={TextField}
            />
            <Button
              mode="strong"
              type="submit"
              disabled={isValidating || isSubmitting}
            >
              Set limit
            </Button>
          </form>
        )
      }}
    </Formik>
  )
}

export default function ChangeELRewardsWithdrawalLimitSidePanel(props) {
  return (
    <SidePanel title="Change limit" {...props}>
      <Panel {...props} />
    </SidePanel>
  )
}
