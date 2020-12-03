import { Button, GU, SidePanel, Info } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'
import { formatJsonData, isHexadecimal } from '../utils/helpers'

const DEFAULT_LIMIT = 20
const LIMIT = process.env.SK_LIMIT || DEFAULT_LIMIT

const initialValues = {
  json: '',
}

const validationSchema = yup.object().shape({
  json: yup
    .string()
    .required()
    .test('json', 'Invalid json file', function (json) {
      let data
      try {
        data = JSON.parse(json)
        if (!Array.isArray(data)) {
          throw new Error('JSON must be an array')
        }
      } catch (e) {
        return this.createError({
          path: 'json',
          message: e.message || 'Invalid JSON',
        })
      }

      const quantity = data.length
      if (quantity < 1)
        return this.createError({
          path: 'json',
          message: `Expected one or more keys but got ${quantity}.`,
        })

      if (quantity > LIMIT)
        return this.createError({
          path: 'json',
          message: `Expected ${LIMIT} signing keys max per submission but got ${quantity}.`,
        })

      for (let i = 0; i < data.length; i++) {
        const { pubkey, signature } = data[i]

        if (!isHexadecimal(pubkey, 96))
          return this.createError({
            path: 'json',
            message: `Invalid pubkey at index ${i}.`,
          })
        if (!isHexadecimal(signature, 192))
          return this.createError({
            path: 'json',
            message: `Invalid signature at index ${i}.`,
          })
      }

      return true
    }),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ json }) => {
      const { quantity, pubkeys, signatures } = formatJsonData(json)

      api(quantity, pubkeys, signatures)
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
              This action will add signing keys to the set of usable keys.
              Please paste the contents of your JSON file into the field below.
            </Info>
            <Field
              name="json"
              label="JSON"
              required
              component={TextField}
              multiline
            />
            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting || isValidating}
              label="Add Signing Keys"
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
