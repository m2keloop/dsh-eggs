import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isZeroSingleOfferPreview } from '../src/adapters/epic/checkout-guard.js'

test('checkout preview requires a single exact offer and every charge to be zero', () => {
  const expected = { namespace: 'ns_1', id: 'offer_1' }
  const order = () => ({
    orderStatus: 'PREVIEW', canQuickPurchase: true,
    lineOffers: [{ offerId: 'offer_1', namespace: 'ns_1', quantity: 1, totalPrice: 0 }],
    totalPrice: 0, paymentCurrencyAmount: 0, redeemRewardAmount: 0, paymentItems: [],
    purchaseOrderPriceSummary: { purchasePrice: { totalPrice: { amount: 0 } }, orderPrice: { amount: 0 }, paymentAmount: { amount: 0 } },
  })
  assert.equal(isZeroSingleOfferPreview(order(), expected), true)
  const mutations = [
    o => { o.orderStatus = 'CREATED' }, o => { o.canQuickPurchase = false },
    o => { o.lineOffers[0].offerId = 'other' }, o => { o.lineOffers[0].namespace = 'other' },
    o => { o.lineOffers[0].quantity = 2 }, o => { o.lineOffers[0].totalPrice = 1 },
    o => { o.lineOffers.push(o.lineOffers[0]) }, o => { o.totalPrice = 1 },
    o => { o.paymentCurrencyAmount = 1 }, o => { o.redeemRewardAmount = 1 },
    o => { o.paymentItems = [{}] }, o => { delete o.paymentItems },
    o => { o.purchaseOrderPriceSummary.purchasePrice.totalPrice.amount = 1 },
    o => { o.purchaseOrderPriceSummary.orderPrice.amount = 1 },
    o => { o.purchaseOrderPriceSummary.paymentAmount.amount = 1 },
    o => { delete o.purchaseOrderPriceSummary.paymentAmount },
  ]
  for (const mutate of mutations) { const value = order(); mutate(value); assert.equal(isZeroSingleOfferPreview(value, expected), false) }
  assert.equal(isZeroSingleOfferPreview(order(), { ...expected, id: '../offer' }), false)
  assert.equal(isZeroSingleOfferPreview(order(), { ...expected, id: 123 }), false)
  assert.equal(isZeroSingleOfferPreview(null, expected), false)
})
