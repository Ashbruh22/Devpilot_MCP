---
title: Discounted price is one cent too low
labels: bug
---
We're using `applyDiscount` for our "33% off" promo and customers are being charged a cent less than the price we show on the product page.

```ts
import { applyDiscount } from 'devpilot-demo/src/pricing';

console.log(applyDiscount(10, 33)); // prints 6.69, expected 6.7
console.log(applyDiscount(20, 33)); // prints 13.39, expected 13.4
```

Other percentages look fine (25% off 200 gives 150). Maybe something with floating point? Our finance team noticed because the totals don't reconcile at the end of the month.
