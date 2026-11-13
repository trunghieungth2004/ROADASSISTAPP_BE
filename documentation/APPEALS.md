# Cases and appeals

The admin console presents behavior reports, money disputes, rating
reviews, and appeals through one **Cases** queue. Backing collections stay
separate; Cases is a normalized view, not a destructive merge.

## Cases

### Kinds

| Kind | Source |
|---|---|
| `BEHAVIOR_REPORT` | `reports` |
| `MONEY_DISPUTE` | `disputes` |
| `RATING_REVIEW` | `appeals` with `subjectKind: RATING` |
| `APPEAL` | `appeals` |

### Surfaces

- Admin → **Cases**: kind/status filters, one queue, kind-specific detail
  dialogs for reports, disputes, and appeals.
- Admin → **Tickets**: ticket status/type filters, rider/provider context,
  payment status, timeline, bill link.
- Admin → **Reports/Disputes/Appeals** remain as deep-link targets; the
  primary navigation is Cases.
- Mobile → **Cases**: ratings, reports, and disputes; tapping a row opens
  the original case and its appeal; actions live inside the detail.
- Admin global search covers users, providers, tickets, and payments.

### Case decisions

- Behavior report: `WARN`, `RESTRICT`, `SUSPEND`, `BLOCK`, dismiss.
- Money dispute: `SHOP`, `RIDER`, `PARTIAL`, dismiss.
- Rating review: `REMOVE`, `KEEP`.
- Appeal: `UPHOLD`, `OVERTURN`, `ADJUST` (and rating `REMOVE`/`KEEP`).

The underlying report/dispute/rating/appeal records remain the source of
truth; the Cases view joins their context and timeline for review.

## Appeals

A single appeal intake for three subjects:

| Subject | Who can appeal | Window | Reasons | Resolutions |
|---|---|---|---|---|
| `RATING` | the rated party | 30 days | `RETALIATORY`, `NOT_THE_SERVICE`, `WRONG_TICKET`, `ABUSIVE_CONTENT`, `SPAM`, `OTHER` | `REMOVE`, `KEEP` |
| `REPORT` | the sanctioned target of a resolved action | 14 days | `FALSE_REPORT`, `NOT_MY_CONDUCT`, `CONTEXT_MISSING`, `NEW_EVIDENCE`, `PROCEDURAL_ERROR`, `OTHER` | `UPHOLD`, `OVERTURN` |
| `DISPUTE` | either party to a decided dispute | 7 days | `NEW_EVIDENCE`, `WRONG_OUTCOME`, `AMOUNT_ERROR`, `PROCEDURAL_ERROR`, `OTHER` | `UPHOLD`, `OVERTURN`, `ADJUST` |

One open appeal per subject per filer. Rating appeals allow two lifetime
attempts; report and dispute appeals allow one. An appeal snapshots the
original rating, report or dispute at filing time so later changes cannot
rewrite the evidence.

### Decision effects

- **Rating `REMOVE`** — marks the rating excluded and recomputes the
  last-100 average. `KEEP` leaves it counted.
- **Report `OVERTURN`** — reverses the report's standing delta, clears a
  restriction caused by that report, and restores a suspended provider
  or blocked rider. A new `standing_events` row records the reversal;
  the original event is never edited.
- **Dispute `OVERTURN`** — applies the opposite outcome. `ADJUST` applies
  a new partial amount. Money already settled is handled as a new
  adjustment/refund, not by rewriting the original settlement.

### Surfaces

- Mobile: **More → Cases**, grouped into Ratings, Reports and Disputes,
  with a shared appeal form.
- Admin: **Cases** filtered to `APPEAL`, with the subject snapshot,
  evidence, and subject-specific decisions.
- Both sides are notified when an appeal is filed and decided.

### Storage

`appeals` stores `subjectKind`, `subjectId`, `ticketId`, `filedBy`,
`reason`, `note`, `photoUrls`, `snapshot`, `status`, `resolution`,
`decisionNote`, `adjustedAmount?`, `decidedBy`, `decidedAt`, `createdAt`.
