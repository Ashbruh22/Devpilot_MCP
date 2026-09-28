# Date handling

## Time zones

All dates are handled in **UTC**. Construct dates with `Date.UTC(...)` or ISO strings ending in `Z`.

## Months are 1-based in our API

`daysInMonth(year, month)` takes `month` as 1–12, unlike JavaScript's 0-based `Date` months.

## Adding months

`addMonths` clamps the day to the target month's length: January 31 + 1 month is the last day of February.

## Invoice terms

`dueDate(issued, termDays)` adds calendar days (default 30).
