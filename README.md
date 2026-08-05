# NYANSATEK Systems — storefront

The e-commerce site for nyansatek.systems: customers pick a product (POS,
School), pay by Mobile Money or card, and get a working account with no one
on the NYANSATEK side touching anything.

```
Customer pays (Paystack) → webhook + client callback verify the charge
    → tenant created in Supabase → SMS + email sent with login
```

## What's in this folder

```
index.html                  Storefront home — product grid
product-pos.html            POS product page + plans
product-school.html         School product page + plans
checkout.html                Business details form + Paystack payment
success.html                 Live provisioning status + delivered login
css/styles.css                Design system
js/products.js                Shared plan/pricing catalog (frontend)
js/checkout.js                Checkout logic + Paystack Inline
js/success.js                 Polls provisioning status
netlify/functions/
  _catalog.js                 Server-side prices (source of truth)
  _supabase.js                 Supabase clients — one per project (POS / School)
  _lib/credentials.js          Username/password generation
  _lib/notify.js                SMS (Hubtel) + email (Resend)
  _provisioners/pos.js          Creates a POS tenant + starter data
  _provisioners/school.js       Creates a School tenant + starter data
  verify-and-provision.js       Verifies payment, routes to the right project, notifies
  provision-status.js           Status polling for success.html
  paystack-webhook.js           Safety net if the tab closes early
supabase/schema.sql            Split by project — see comments inside
netlify.toml                    Build + headers config
```

## 1. Accounts you need

| Service | Why | Get it at |
|---|---|---|
| Paystack | Card + Mobile Money checkout | paystack.com — enable Ghana, GHS |
| Supabase | Same project pattern you're already using for tenants | supabase.com |
| Hubtel (or mNotify) | SMS delivery in Ghana | hubtel.com |
| Resend (or Postmark) | Transactional email | resend.com |
| Netlify | Hosting + serverless functions | netlify.com |

## 2. Database setup — two Supabase projects, not one

You're on Supabase's free tier with 2 projects already in use: one behind
**nyansatek.shop** (POS) and one behind **nyansatek-attendance.netlify.app**
(School). The storefront doesn't get a third project — it writes into
whichever of those two projects actually backs the product a customer
bought. `netlify/functions/_supabase.js` handles this: `getSupabaseFor("pos")`
and `getSupabaseFor("school")` return clients pointed at the right project,
so a school purchase can never accidentally land in the POS database or
vice versa.

Open `supabase/schema.sql` — it's split into labeled sections. Run each
section **only** in the project named in its comment:

- **In the POS project (nyansatek.shop):** run the `provisioning_jobs`
  table, plus the example `businesses`/`categories`/`stores` tables.
  `provisioning_jobs` tracks every purchase from "verifying" through
  "complete" — regardless of which product was bought — and lives here by
  convention, not because it's POS-specific. This is also what makes
  retries safe: a reference is only ever provisioned once, even if the
  webhook and the client callback both fire.
- **In the School project (nyansatek-attendance):** run the example
  `schools`/`terms`/`classes` tables.

Both sets of example tenant tables are a starting guess — **reconcile them
with whatever tables already exist** in each project (your
`tenant-onboarding-template.sql` for POS, and whatever nyansatek-attendance
already uses for schools), then update `netlify/functions/_provisioners/pos.js`
and `school.js` to insert into the real table/column names.

RLS is turned on with **no policies** on every table, so only the service
role key (used exclusively inside Netlify functions, never the browser)
can read or write them.

## 3. Environment variables

Set these in Netlify (Site settings → Environment variables). **Never**
put any of these in frontend code — only `PAYSTACK_PUBLIC_KEY` is safe to
expose, and it's already the only one referenced in `js/checkout.js`.

```
PAYSTACK_SECRET_KEY              sk_live_...        (server only)

SUPABASE_POS_URL                 https://xxxx.supabase.co   (nyansatek.shop's project)
SUPABASE_POS_SERVICE_ROLE_KEY    (server only — full DB access to that project)

SUPABASE_SCHOOL_URL              https://yyyy.supabase.co   (nyansatek-attendance's project)
SUPABASE_SCHOOL_SERVICE_ROLE_KEY (server only — full DB access to that project)

HUBTEL_CLIENT_ID
HUBTEL_CLIENT_SECRET
HUBTEL_SENDER_ID             e.g. NYANSATEK (must be pre-approved with Hubtel)
RESEND_API_KEY
EMAIL_FROM                   accounts@nyansatek.systems (needs domain verified in Resend)
```

Find each Supabase URL/key pair under that project's own dashboard →
Project Settings → API. The POS and School values come from two different
Supabase projects — don't mix them up, since a swapped key would let a
school purchase attempt to write into the shop's database and fail (or,
worse, if you ever reuse similar table names between projects, write into
the wrong tenant's tables).

Then open `js/checkout.js` and replace the placeholder:

```js
const PAYSTACK_PUBLIC_KEY = "pk_test_REPLACE_WITH_YOUR_PAYSTACK_PUBLIC_KEY";
```

with your real `pk_live_...` key once you're ready to take real payments
(use `pk_test_...` + Paystack's test cards/MoMo numbers while building).

## 4. Wire up the Paystack webhook

In the Paystack dashboard → Settings → API Keys & Webhooks, set:

```
https://nyansatek.systems/.netlify/functions/paystack-webhook
```

This is the safety net described in the architecture note in
`paystack-webhook.js` — it exists so that if a customer pays and closes
the browser tab before `success.html` finishes its call, the account still
gets created. Both paths funnel through the same `verify-and-provision`
function and the same idempotency check, so nothing double-provisions.

## 5. Deploy

```bash
netlify init      # link this folder to a new or existing Netlify site
netlify env:set PAYSTACK_SECRET_KEY sk_live_xxx
# ...repeat for each variable above, or set them in the Netlify UI...
netlify deploy --prod
```

Point your domain registrar's DNS for `nyansatek.systems` at Netlify
(Netlify's UI gives you the exact records once the site exists).

## 6. Before going live

- [ ] Swap `pk_test_...` for `pk_live_...` in `js/checkout.js`
- [ ] Confirm Hubtel sender ID is approved (unapproved sender IDs get
      silently dropped by Ghanaian telcos)
- [ ] Verify your sending domain in Resend so email doesn't land in spam
- [ ] Update `product-school.html` and `_catalog.js` to point at
      `https://nyansatek.school` once that domain replaces
      `nyansatek-attendance.netlify.app`
- [ ] Test the full flow with a real small MoMo payment, not just
      Paystack test mode — Mobile Money has its own quirks test cards
      don't catch
- [ ] Decide what happens on **subscription renewal** — this build
      provisions on the *first* payment; recurring billing (Paystack
      Subscriptions/Plans) is a separate piece worth adding once the
      one-time flow is solid

## Adding a third product later

1. Add it to both `js/products.js` (frontend prices) and
   `netlify/functions/_catalog.js` (server prices — these must match).
2. Add a provisioner file under `netlify/functions/_provisioners/`.
3. Register it in the `PROVISIONERS` map in `verify-and-provision.js`.
4. Copy `product-pos.html` as a starting template for its product page.
5. Add a card to the grid in `index.html`.

No other part of the checkout/payment/notification pipeline needs to
change — that's the point of keeping product-specific logic isolated to
one small file per product.
