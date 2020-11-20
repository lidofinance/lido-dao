import React from 'react'
import { Button, GU, SidePanel, Info } from '@aragon/ui'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  credentials: '',
}

const validationSchema = yup.object().shape({
  credentials: yup
    .string()
    .required()
    .test(
      'credentials',
      'Credentials must be a 64-character hexadecimal number',
      (credentials) => {
        const hasPrefix = credentials.substring(0, 2) === '0x'
        const withoutPrefix = hasPrefix ? credentials.substring(2) : credentials
        const regex = /^[a-fA-F0-9]{64}$/
        return regex.test(withoutPrefix)
      }
    ),
})

function Panel({ onClose, apiSetWC }) {
  const handleFormikSubmit = ({ credentials }) => {
    const hasPrefix = credentials.substring(0, 2) === '0x'
    const withdrawalCredentials = hasPrefix ? credentials : `0x${credentials}`
    apiSetWC(withdrawalCredentials)
      .toPromise()
      .catch(console.error)
      .finally(() => {
        onClose()
      })
  }

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={handleFormikSubmit}
      validateOnBlur={false}
      validateOnChange={false}
    >
      {({ submitForm, isSubmitting }) => {
        const handleSubmit = (event) => {
          event.preventDefault()
          submitForm()
        }
        return (
          <form
            css={`
              margin-top: ${3 * GU}px;
            `}
            onSubmit={handleSubmit}
          >
            <Info
              title="Action"
              css={`
                margin-bottom: ${3 * GU}px;
              `}
            >
              This action will change the withdrawal credentials.
            </Info>
            <Field name="credentials" label="Referral" component={TextField} />
            <Button mode="strong" type="submit" disabled={isSubmitting}>
              Set withdrawal credentials
            </Button>
          </form>
        )
      }}
    </Formik>
  )
}

export default function ChangeWCSidePanel(props) {
  return (
    <SidePanel title="Change withdrawal credentials" {...props}>
      <Panel {...props} />
    </SidePanel>
  )
}
