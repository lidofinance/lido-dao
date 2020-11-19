import { Button, GU, SidePanel, Info } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  treasury: '0',
  insurance: '0',
  operators: '0',
}

const validationSchema = yup.object().shape({
  treasury: yup.number().positive().required(),
  insurance: yup.number().positive().required(),
  operators: yup.number().positive().required(),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    (values) => {
      api(...values).then(() => {
        onClose()
      })
    },
    [api, onClose]
  )

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={onSubmit}
      validateOnBlur={false}
      validateOnChange={false}
    >
      {({ submitForm, isSubmitting }) => {
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
              This action will change the fee distribution for treasury,
              insurance and operators.
            </Info>
            <Field
              name="treasury"
              type="number"
              label="Treasury fee"
              component={TextField}
            />
            <Field
              name="insurance"
              type="number"
              label="Insurance fee"
              component={TextField}
            />
            <Field
              name="operators"
              type="number"
              label="Operators fee"
              component={TextField}
            />
            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting}
              label="Submit"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="Change fee distribution" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
