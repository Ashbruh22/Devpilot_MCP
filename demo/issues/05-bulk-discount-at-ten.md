---
title: orderTotal doesn't apply bulk discount for exactly 10 items?
labels:
---
I ordered exactly 10 units at $10 with a 10% coupon and got **85.5**. I expected 90 (100 minus 10%). Is the bulk discount kicking in at 10 instead of above 10? Is that intended?

```ts
orderTotal([{ sku: 'mug', unitPrice: 10, quantity: 10 }], 10); // 85.5
```
