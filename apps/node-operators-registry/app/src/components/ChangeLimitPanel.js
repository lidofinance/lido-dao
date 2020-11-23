import { Button, GU, SidePanel, Info } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  limit: 0,
}

const validationSchema = yup.object().shape({
  limit: yup.number().positive().integer().required().min(0),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ limit }) => {
      api(limit)
        .catch(console.error)
        .then(() => {
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
      {({ values, errors, submitForm, isSubmitting, isValidating }) => {
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
            <pre>{JSON.stringify(values, null, 2)}</pre>
            <pre>{JSON.stringify(errors, null, 2)}</pre>
            <Info
              title="Action"
              css={`
                margin-bottom: ${3 * GU}px;
              `}
            >
              This action will change the maximum number of validators to stake
              for the chosen node operator.
            </Info>
            <Field
              name="limit"
              label="Limit"
              type="number"
              required
              component={TextField}
            />
            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting || isValidating}
              label="Set limit"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
