# Rounding rules

All money values are rounded half-up to two decimal places (cents).

## Why not floor?

Flooring loses a cent on values like 6.699999 due to floating point error.

## Currency formatting

`formatPrice` always prints two decimals with a leading dollar sign.
