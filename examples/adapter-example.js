// A fully local demonstration, not a real benefit or an installed adapter.
// Every call and value here is synthetic; replace the methods for a real site.
export const exampleSettings = [{ key: 'region', label: '地区', choices: [{ value: 'CN', label: '中国' }, { value: 'US', label: '美国' }], defaultValue: 'CN' }]
export function createExampleAdapter() {
  let owned = false
  return {
    async authenticate(credential) {
      if (credential !== null) throw new Error('Unexpected credential')
      return { subject: 'public-example' }
    },
    async discover({ settings }) {
      return [{ namespace: 'example', id: `example-period-${settings.region}`, cycleKey: 'example-cycle', expiresAt: '2099-01-01T00:00:00.000Z' }]
    },
    async verify() { return owned ? 'owned' : 'not_owned' },
    async submit() { owned = true },
  }
}
