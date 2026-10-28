<div align="center">
  <img src="public/favicon.svg" alt="" width="64">
  <h1>Quartermaster</h1>
  <p>A static trip-cost splitter for groups.</p>
</div>

Quartermaster is built with Astro and Node.js. Trip data stays in your browser;
there are no accounts, uploads, or payment integrations.

## Run locally

Use the exact Node.js and npm versions in [package.json](package.json)
(`devEngines`). npm checks them before installing dependencies or running tasks.

```sh
npm ci --ignore-scripts
npm run dev
```

Open the reported address, including `/qtrmstr/`. Stop the server with Ctrl-C.

## Check and build

```sh
npm run audit
npm run check
npm test
npm run build
```

The build writes `dist/`. Run `npm run preview` to serve that build locally.

The [GitHub Pages workflow](.github/workflows/pages.yml) checks and publishes
`main`. For another repository or domain, update `site` and `base` in
[astro.config.mjs](astro.config.mjs).

## Dependency updates

Choose an exact package version released at least seven days ago. Replace
`PACKAGE@VERSION` below with that package and version:

```sh
npm install --save-dev --save-exact PACKAGE@VERSION --ignore-scripts
npm audit signatures
```

Review changes to `package.json` and `package-lock.json`, including transitive
dependencies. Then run `npm ci --ignore-scripts` and the checks above. Keep the
cooldown and installation-script restrictions enabled. See [Security](SECURITY.md)
for the policy and its limits.

## Use the site

1. **Crew:** name the trip, choose one currency, and add at least two people.
2. **Ship’s tab:** enter a cost, its payer, and who shares it. Select one person
   to assign the whole cost or several to split it evenly. For itemized
   receipts, assign each item and enter tax and tip as amounts, not percentages.
3. **Settle up:** review who owes whom, then download a CSV or save a PDF.

Under **Crew → Settle together**, group two or more people to combine their
balances for settlement. Each person keeps their own share. Group names follow
their members, such as **Alex & Jamie**.

Convert foreign costs before entering them. Currency is locked while costs
exist.

## Calculations

- Amounts use integer cents. Even splits give extra pennies in recorded
  participant order.
- Receipt tax and tip are proportional to each person’s item subtotal. Each
  extra is rounded separately: round down to cents, then assign remaining
  pennies by largest fractional remainder. Recorded order breaks ties.
- Adding people or changing groups does not alter saved cost allocations. Edit a
  cost to change who shares it.
- Balances equal **paid − share**. Suggested payments settle those balances;
  Quartermaster does not send or track payments.

## CSV and PDF

**Download CSV** includes the crew, groups, costs, receipts, and calculations.
It also works before costs are added. Share the file and website link; friends
can use **Crew → Import CSV** to load their own copy. Changes do not sync.

Import validates source data and recalculates totals, then asks you to confirm
replacing the current trip. Imports and exports use one versioned format. To
prepare a file manually or with an agent, use the
[CSV template](public/quartermaster-template.csv) and
[CSV guide](public/quartermaster-csv-guide.txt). Older CSV formats are not
supported.

**Save PDF** opens the browser’s print dialog. Choose **Save as PDF** for
payments, balances, and a cost summary. Select **Include receipt & split details
in PDF** for the full breakdown. PDFs cannot be imported.

## Drafts and limits

One unencrypted draft is saved in this browser. **Reset trip** clears it. Export
before clearing browser data, replacing a trip, or closing the page when saving
fails. See [data and privacy](SECURITY.md#data-and-privacy) for who can access
drafts.

| Limit                           |                Maximum |
| ------------------------------- | ---------------------: |
| People                          |                     50 |
| Items per receipt               |                    100 |
| Costs or receipt items combined |                  1,000 |
| Cost or receipt total           |          999,999,999.99 |
| CSV file                        |  8 MB (8,000,000 bytes) |

Costs must be positive. Tax and tip can be zero. Browser storage quotas vary.
