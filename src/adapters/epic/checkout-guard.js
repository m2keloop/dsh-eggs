const ID = /^[A-Za-z0-9_-]{1,120}$/

// Experimental guard for a single preview, based on the Epic checkout shape
// observed by another Epic marketplace. This is not yet validated on EGS and
// must not by itself authorize submission of an order.
export function isZeroSingleOfferPreview(value, expected) {
  if (typeof expected?.id !== 'string' || typeof expected?.namespace !== 'string' || !ID.test(expected.id) || !ID.test(expected.namespace)) return false
  if (!value || value.orderStatus !== 'PREVIEW' || value.canQuickPurchase !== true || !Array.isArray(value.lineOffers) || value.lineOffers.length !== 1) return false
  const line = value.lineOffers[0]
  if (!line || line.offerId !== expected.id || line.namespace !== expected.namespace || line.quantity !== 1 || line.totalPrice !== 0) return false
  if (value.totalPrice !== 0 || value.paymentCurrencyAmount !== 0 || value.redeemRewardAmount !== 0) return false
  if (!Array.isArray(value.paymentItems) || value.paymentItems.length !== 0) return false
  const summary = value.purchaseOrderPriceSummary
  return summary?.purchasePrice?.totalPrice?.amount === 0 && summary?.orderPrice?.amount === 0 && summary?.paymentAmount?.amount === 0
}
