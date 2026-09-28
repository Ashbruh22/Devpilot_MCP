# Pricing rules

## Discounts

`applyDiscount(amount, percent)` takes a percentage between 0 and 100. Anything else throws a `RangeError`.

## Rounding

All money values are rounded **half-up to the nearest cent**. Never truncate: floating point turns
6.70 into 6.699999999999999, and truncation would charge 6.69.

## Bulk tiers

| Quantity | Discount |
| -------- | -------- |
| 10+      | 5%       |
| 50+      | 10%      |
| 100+     | 15%      |

Bulk discounts apply per line; coupons apply to the discounted order total.
