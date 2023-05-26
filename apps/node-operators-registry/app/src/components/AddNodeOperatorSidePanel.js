import { Button, GU, SidePanel } from '@aragon/ui'
import React from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  name: '',
  address: '',
}

const validationSchema = yup.object().shape({
  name: yup.string().required().min(1),
  address: yup.string().required().min(1),
})

function PanelContent({ addNodeOperatorApi, onClose }) {
  const onSubmit = ({ name, address }) => {
    addNodeOperatorApi(name, address)
      .catch(console.error)
      .finally(() => {
        onClose()
      })
  }

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={onSubmit}
      validateOnBlur={false}
      validateOnChange={false}
    >
      {({ submitForm, isSubmitting, errors, values }) => {
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
            <pre>
              {JSON.stringify(errors, null, 2)}
              {JSON.stringify(values, null, 2)}
            </pre>
            <Field name="name" label="Name" required component={TextField} />
            <Field
              name="address"
              label="Address"
              required
              component={TextField}
            />

            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting}
              label="Add Node Operator"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="ADD NODE OPERATOR" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
