import { Button, GU, SidePanel, Info } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const TREASURY = 'treasury'
const INSURANCE = 'insurance'
const OPERATORS = 'operators'

const initialValues = {
  [TREASURY]: 0,
  [INSURANCE]: 0,
  [OPERATORS]: 0,
}

const getFieldSchema = (fieldName) => {
  return yup
    .number()
    .positive()
    .required()
    .min(0)
    .max(100)
    .test(
      fieldName,
      `${fieldName} must be an integer or have 1 or 2 decimal places.`,
      (value) => {
        const regex = /^\d{1,3}(\.\d{1,2})?$/
        return regex.test(value)
      }
    )
}

const validationSchema = yup
  .object()
  .shape({
    [TREASURY]: getFieldSchema(TREASURY),
    [INSURANCE]: getFieldSchema(INSURANCE),
    [OPERATORS]: getFieldSchema(OPERATORS),
  })
  .test({
    name: 'total',
    test: function ({ operators, insurance, treasury }) {
      const total =
        parseFloat(operators) + parseFloat(insurance) + parseFloat(treasury)
      if (total === 100) return true

      return this.createError({
        path: 'total',
        message: 'All fields must total to 100.',
      })
    },
  })

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ treasury, insurance, operators }) => {
      const treasuryBp = treasury * 100
      const insuranceBp = insurance * 100
      const operatorsBp = operators * 100

      api(treasuryBp, insuranceBp, operatorsBp)
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
      onSubmit={onSubmit}
      validateOnBlur={false}
      validateOnChange={false}
    >
      {({ submitForm, errors, isSubmitting }) => {
        const handleSubmit = (e) => {
          e.preventDefault()
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
              This action will change the fee distribution for treasury,
              insurance and operators.
            </Info>
            <Field
              name={TREASURY}
              type="number"
              label="Treasury fee (%)"
              component={TextField}
            />
            <Field
              name={INSURANCE}
              type="number"
              label="Insurance fee (%)"
              component={TextField}
            />
            <Field
              name={OPERATORS}
              type="number"
              label="Operators fee (%)"
              component={TextField}
            />
            {errors.total && (
              <Info
                mode="error"
                css={`
                  margin-bottom: ${3 * GU}px;
                `}
              >
                {errors.total}
              </Info>
            )}
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
