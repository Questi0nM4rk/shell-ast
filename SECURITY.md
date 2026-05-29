# Security Policy

`shell-ast` parses shell strings into a typed AST; it never executes them
(the test suite enforces this — CI greps the source tree for any
process-execution API and fails the build on a match). Even so, downstream
security tools build on this parser, so a parsing bug here can become a
policy-bypass there. Reports are taken seriously.

## Supported versions

Security fixes land on the **latest published minor**. Older minors are not
back-patched — upgrade to the latest release to receive fixes.

| Version | Supported |
|---|---|
| Latest minor (current `0.x`) | ✓ |
| Any older minor | ✗ — upgrade to the latest |

Once `1.0.0` ships, this table is updated to track the 1.x line plus any
explicitly designated LTS window.

## Reporting a vulnerability

**Please report privately — do not open a public issue for a security bug.**

Preferred: open a [GitHub Security Advisory](https://github.com/Questi0nM4rk/shell-ast/security/advisories/new)
on this repository ("Report a vulnerability"). This keeps the report private
until a fix is published and lets us collaborate on a patch.

If you cannot use Security Advisories, open a minimal public issue at
<https://github.com/Questi0nM4rk/shell-ast/issues> that says only "security
report — please enable private contact" (no details), and a private channel
will be arranged.

Useful details, when you have them:

- Affected version(s) and runtime (Node / Bun / `bun build --compile`).
- A minimal input string that triggers the issue.
- Observed vs. expected parse / unwrap / effect-classification behavior.
- The downstream impact you foresee (e.g. a rule-bypass shape for a consumer).

## Response window

This is a single-maintainer project. Expect:

- **Acknowledgement within 7 days** of the report.
- **An assessment and remediation plan within 30 days** for confirmed issues.

Confirmed vulnerabilities are fixed in a patch release on the latest minor,
credited to the reporter in the release notes and advisory unless anonymity
is requested.
