const KEY = /^[a-z][a-z0-9_]{0,31}$/
const VALUE = /^[A-Za-z0-9_-]{1,50}$/
const invalid = () => Object.assign(new Error('Benefit settings require attention'), { code: 'SETTINGS_REQUIRED' })

// Public, predefined choices only. Secret or free-form user input belongs in
// an adapter's credential flow, never in these unencrypted configuration fields.
export function validateSettingFields(fields = []) {
  if (!Array.isArray(fields) || fields.length > 8) throw new Error('Invalid settings declaration')
  const seen = new Set()
  return fields.map(field => {
    if (!field || typeof field.key !== 'string' || !KEY.test(field.key) || seen.has(field.key) || ['constructor', 'prototype', '__proto__'].includes(field.key)) throw new Error('Invalid setting key')
    if (typeof field.label !== 'string' || !field.label.trim() || field.label.length > 80 || !Array.isArray(field.choices) || !field.choices.length || field.choices.length > 50) throw new Error('Invalid setting field')
    seen.add(field.key)
    const choices = field.choices.map(choice => {
      if (!choice || typeof choice.value !== 'string' || !VALUE.test(choice.value) || typeof choice.label !== 'string' || !choice.label.trim() || choice.label.length > 80) throw new Error('Invalid setting choice')
      return { value: choice.value, label: choice.label }
    })
    if (new Set(choices.map(choice => choice.value)).size !== choices.length) throw new Error('Duplicate setting choice')
    const defaultValue = field.defaultValue ?? choices[0].value
    if (!choices.some(choice => choice.value === defaultValue)) throw new Error('Invalid setting default')
    return { key: field.key, label: field.label, choices, defaultValue }
  })
}

export function resolveSettings(fields, supplied = {}) {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw invalid()
  const allowed = new Set(fields.map(field => field.key))
  if (Object.keys(supplied).some(key => !allowed.has(key))) throw invalid()
  const result = {}
  for (const field of fields) {
    const value = Object.hasOwn(supplied, field.key) ? supplied[field.key] : field.defaultValue
    if (!field.choices.some(choice => choice.value === value)) throw invalid()
    result[field.key] = value
  }
  return result
}

// Existing configurations must explicitly contain each field; a newly added
// setting is not silently applied to an already configured benefit.
export function resolvePersistedSettings(fields, supplied) {
  if (fields.length && (!supplied || fields.some(field => !Object.hasOwn(supplied, field.key)))) throw invalid()
  return resolveSettings(fields, supplied)
}
