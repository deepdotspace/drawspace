/**
 * Subscription plan declarations.
 *
 * Edit this file then `deepspace deploy` to sync the plans to Stripe Products
 * and Prices. Keep `slug` stable — subscribers and tier checks refer to it.
 *
 * Minimum prices: $3/month, $12/year — below this Stripe's per-transaction
 * fee ($0.30 + 2.9%) eats most of the charge, so the developer would receive
 * almost nothing per payout. Free plans don't hit Stripe at all.
 */

export const subscriptionPlans = [
  {
    slug: 'free',
    name: 'Free',
    priceCents: 0,
  },
  {
    slug: 'pro',
    name: 'Pro',
    priceCents: 900,        // $9/month
    yearlyCents: 9000,         // optional — $90/year (drop for month-only)
    taxCode: 'txcd_10000000',  // optional — defaults to this (digital services)
  },
] as const

export type SubscriptionPlanSlug = (typeof subscriptionPlans)[number]['slug']
