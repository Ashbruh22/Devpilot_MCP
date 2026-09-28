---
title: Monthly renewals scheduled on Jan 31 jump to March 2
labels:
---
Our billing service schedules the next renewal with `addMonths(lastRenewal, 1)`. For a subscription that renewed on 2024-01-31 we got a renewal date of **2024-03-02**, which skips February entirely. Our own sanity check caught it:

```
Error: Renewal date 2024-03-02 is not in the expected month 2024-02
    at assertRenewalMonth (/srv/billing/src/renewals.js:41:11)
    at scheduleRenewal (/srv/billing/src/renewals.js:18:3)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async runNightlyBilling (/srv/billing/src/jobs/nightly.js:27:7)
```

The docs say `addMonths` should clamp to the last day of February. Happens for Jan 29/30/31 in 2024; Jan 15 works fine.
