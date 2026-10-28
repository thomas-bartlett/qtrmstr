# Security

## Data and privacy

- One unencrypted draft is saved in this browser; it does not upload or sync.
- Other users of this browser profile and scripts on the same origin can read
  the draft. GitHub Pages projects can share an origin.
- **Reset trip** deletes the draft. Downloaded CSVs and PDFs must be deleted
  separately.

## Input and output

- Imports and drafts are validated against the [trip limits](README.md#drafts-and-limits).
  File contents are never executed.
- Imports require confirmation and recalculate all totals from source data.
  Review amounts and people; validation cannot establish receipt accuracy.
- User text renders as text, not HTML. CSV fields are quoted and formula prefixes
  are escaped. Spreadsheet apps may strip escaping when saving again: keep the
  original export and load untrusted cells as text.
  See [OWASP's CSV guidance](https://community.owasp.org/attacks/CSV_Injection).
- CSP restricts resources to this origin and blocks network API calls and form
  submissions. Its HTML policy does not provide framing protection.

## Dependencies

- Node.js, npm, and direct dependencies are pinned in `package.json`. The lockfile
  records versions and integrity hashes. Install with `npm ci --ignore-scripts`.
- `.npmrc` disables install scripts and allows only registry dependencies.
  Explicit tasks such as `npm run build` still execute.
- Versions must be at least seven days old, including security fixes. npm applies
  this when choosing versions; `npm ci` trusts the reviewed lockfile. Keep the
  cooldown and install-script restrictions enabled.
- Follow the [update procedure](README.md#dependency-updates): review lockfile
  changes and run `npm audit signatures`. Invalid signatures block acceptance.
  Signatures and audits do not guarantee harmless code.

Builds execute third-party code with local process access. Disabling install
scripts does not sandbox builds.

## Deployment

- CI requires audit, type checks, tests, and a successful build. Audit findings
  and registry failures block deployment.
- Actions are pinned to commit hashes. Build permissions are read-only;
  deployment permissions are limited to publishing. Only `main` can publish.
