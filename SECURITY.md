# Security Policy

## Supported versions

The latest published minor of barkup receives security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
("Security" tab → "Report a vulnerability"). Reports are typically
acknowledged within a few days.

barkup has zero runtime dependencies and performs no network, filesystem,
or shell access; the primary security surface is markup parsing. Guarantee
violations (silent tree repair, id mutation, undeclared coercion) are
treated as security-relevant bugs.
