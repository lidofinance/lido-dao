import { Button, GU, SidePanel, Info, SyncIndicator } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'
import {
  checkForDuplicatesAsync,
  formatJsonData,
  hasDuplicatePubkeys,
  hasDuplicateSigs,
  isHexadecimal,
  SIGNATURE_VERIFY_ENDPOINT,
  SUBGRAPH_ENDPOINT,
  verifySignaturesAsync,
} from '../utils/helpers'
import CheckBox from './CheckBox'

const DEFAULT_LIMIT = 20
const LIMIT = process.env.SK_LIMIT || DEFAULT_LIMIT

const initialValues = {
  json: '',
  useAdvancedV8n: false,
}

const validationSchema = yup
  .object()
  .shape({
    json: yup.string().required(),
  })
  .test('basic', 'Invalid json file', function ({ json }) {
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

    if (hasDuplicatePubkeys(data))
      return this.createError({
        path: 'json',
        message: 'Includes duplicate public keys',
      })

    if (hasDuplicateSigs(data))
      return this.createError({
        path: 'json',
        message: 'Includes duplicate signatures',
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
  })
  .test('advanced', 'Invalid keys', async function ({ json, useAdvancedV8n }) {
    if (!useAdvancedV8n) return true

    const signingKeys = JSON.parse(json)

    const duplicates = await checkForDuplicatesAsync(signingKeys)
    if (duplicates.length) {
      return this.createError({
        path: 'json',
        message: `Public keys already in use: ${duplicates.join(', ')}`,
      })
    }

    const invalidSignatures = await verifySignaturesAsync(signingKeys)
    if (invalidSignatures.length) {
      return this.createError({
        path: 'json',
        message: `Invalid signatures: ${invalidSignatures.join(', ')}`,
      })
    }

    return true
  })

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    async ({ json }) => {
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
            {SIGNATURE_VERIFY_ENDPOINT && SUBGRAPH_ENDPOINT && (
              <Field name="useAdvancedV8n" component={CheckBox} />
            )}
            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting || isValidating}
              label="Add Signing Keys"
              type="submit"
            />
            <SyncIndicator visible={isValidating} shift={50}>
              Validation is in progress. This may take a couple of minutes...
            </SyncIndicator>
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
