# Nearby: a TryNearby-style local-creator subscription, rebuilt for WhatsApp in the UK and Dubai

**Short answer: yes, it can run over WhatsApp, and in the UK and UAE it should.** TryNearby runs its whole creator side over iMessage, which only works in the US. In both target markets WhatsApp is the default messenger, has an official business API with buttons, lists, location sharing and approved templates, and costs well under £1 per creator visit. This folder contains a working reference implementation of the loop (creator onboarding → matching → invite → booking → reminders → post proof) on the WhatsApp Cloud API, with the UK and UAE differences (disclosure rules, the UAE advertiser permit, quiet hours, currency, halal / no-alcohol matching) isolated in one market table.

One thing to be clear about up front: **TryNearby has no public code.** There is no GitHub organisation, no open-source SDK and no published API. Everything below about how it works comes from their site, YC profile, launch post, press and founder posts, cross-checked where possible. The code in this folder is a clean-room rebuild of the mechanics they describe, not a copy.

```
npm install
npm test        # 24 tests: matching, onboarding, the monthly loop, WhatsApp adapter, time rules
npm run demo    # scripted London + Dubai walk-through on a simulated WhatsApp transport
npm start       # Fastify webhook server; uses the Cloud API if WHATSAPP_* env vars are set
```

---

## 1. What TryNearby is

| | |
|---|---|
| Product | "Word-of-mouth marketing on autopilot for restaurants." A restaurant subscribes; every month a new group of vetted creators who live nearby is booked in, eats a comped meal, films, edits and posts a review to their own account. |
| Price | **$399 / month**, flat. Five creators per month is the standard allocation. |
| Markets | Los Angeles, Orange County, San Diego. Other cities waitlisted. |
| Traction (Aug 2026 launch post) | 120+ paying restaurants, 2,500+ videos posted, "thousands" of creators. 130%+ growth during the YC S26 batch, 37% month-on-month since Nov 2025, 90%+ retention. |
| Company | Founded 2025, Los Angeles, 5 people, YC S26. |
| Founders | Yousef Abdelfattah (FaZe Apex, co-founder of FaZe Clan), Obaida Albaroudi (ex-Replit, ex-Goldman, co-founder of Clipping Exe) and Ahmad Ibrahim (CTO of Clipping Exe, UC Berkeley CS). Clipping Exe was an early clipping/clip-tracking business that processed tens of thousands of videos a month and tracked billions of views, which is where the "tracking" muscle comes from. |
| Distribution | Restaurant trade channels (California Restaurant Association listing and trade-show booth), founder audience, YC launch. |

### How the machine works

1. **Restaurant signs up** on the web, sets hospitality (what the comped meal is, how many guests) and hours it will host.
2. **A matching agent** finds creators nearby who fit that venue and sends invites. Founders claim creators are sometimes scheduled within five minutes of a venue signing up.
3. **Every creator is managed over iMessage by an agent they built**: onboarding, match invites, booking, reminders, reschedules and questions. It handles 10,000+ texts a month. Every conversation adds to what it knows about the creator (what they eat, how far they will drive, when they are free, what they turn down) and that feeds the next match.
4. **Creator visits, films, edits, posts** to their own TikTok / Instagram. Content stays on the creator's account; the restaurant is not buying usage rights, it is buying reach in the "local algorithm" (geo-distribution on TikTok and Instagram, plus Google and Yelp surface area).
5. **Tracking**: TryNearby records the posts and reports exposure back to the venue across TikTok, Instagram, Google and Yelp.

### The business model, taken apart

- **Revenue**: ~120 × $399 ≈ **$48k MRR, ~$575k ARR** at launch, growing ~37% a month. Flat pricing means the sales conversation is "one number, cancel any time".
- **Who pays the creators**: the restaurant does, in food. A comped meal for two costs the venue perhaps $25–50 in food cost, so five visits is roughly $150–250 of kitchen cost on top of the $399. TryNearby itself pays creators nothing in cash at the base tier ("get paid to create content" on the creator page is the meal).
- **Marginal cost per venue** is close to zero: messaging is free on iMessage, the LLM calls are cents, and the humans are a small ops team. That is a software gross margin on what looks like an agency service.
- **Why venues buy**: agencies charge £2–5k a month plus a markup, and marketplaces (Joli, Fleek, Barter) still make the venue do the outreach, vetting and chasing. TryNearby sells the removal of that labour and a guaranteed cadence.
- **Why creators join**: nano and micro creators (1k–20k followers) have abundant supply and no monetisation; a reliable stream of free meals near home, with zero negotiation, is a real offer.
- **What compounds**: the creator graph. Reliability (show-up rate, time-to-post), taste and radius data make each month's matching better and reduce the two failure modes that kill this category: no-shows and posts that never appear. That data does not transfer to a competitor.
- **Risks they carry** (and that a UK/Dubai clone inherits): churn if the venue does not see covers move; disclosure enforcement (FTC in the US; ASA/CMA and the UAE Media Council here); Yelp explicitly penalises solicited reviews, so "exposure on Yelp" is a claim to be careful with; content quality control when the venue never picks the creator.

---

## 2. Why WhatsApp is the right pipe here, and the constraints it brings

**Reach.** WhatsApp has ~30 million monthly users in the UK and passes 80–90% of the population in the UAE. iMessage-only would exclude every Android creator (roughly half of UK phones, the majority in the UAE) and needs a Mac-side bridge or a third-party iMessage relay, none of which Apple officially supports. WhatsApp has an official API from Meta.

**What the WhatsApp Business Platform gives us** (all used in this implementation):

| Need | WhatsApp feature |
|---|---|
| "Accept / Decline" | Interactive reply buttons (max 3, 20-char titles) |
| "Pick a slot" | Interactive list message (max 10 rows, 24-char titles) |
| "Where are you based?" | Native location share, or free text geocoded |
| "Send the post link" | Plain text; the engine extracts the URL |
| Messaging a creator who has been silent | Pre-approved **template** messages with quick-reply buttons |
| Longer forms (permit numbers, availability) | WhatsApp Flows (not needed for v1) |
| Free creator acquisition | Click-to-WhatsApp ads open a 72-hour free entry-point window |

**The three hard rules the code enforces:**

1. **The 24-hour window.** You can send anything within 24h of the creator's last message. Outside it, only an approved template may be sent. `Engine.notify()` picks free-form or template automatically, and the scheduler never sends a raw message to a silent creator. The five templates we need are in `src/whatsapp/templates.ts` (invite, reminder, post request, venue booking, re-engage), all submitted as *utility* category, which is roughly half the price of *marketing*.
2. **Quiet hours.** The UAE's TDRA rules prohibit late-night promotional sends; the UK has no hard rule but creators hate it. Both markets are set to 08:00–21:00 local. Sends outside the window are queued and re-checked for relevance before they go out (a reminder for a cancelled visit is dropped, not sent late).
3. **Meta's AI policy.** Since 15 January 2026 Meta bans *general-purpose* AI chatbots on the Business API. Task-specific business bots are explicitly allowed. This engine is a state machine; the model is only used to classify free text into a closed list of intents (`src/domain/intent.ts`), never to chat. Keep it that way.

**Cost.** Meta moved to per-message pricing in July 2025 and from 1 October 2026 also charges for replies inside the 24h window (previously free). Working figures (Meta base rates, before any BSP markup):

| Market | Utility | Marketing |
|---|---|---|
| UK | ≈ $0.022 | ≈ £0.038 |
| UAE | ≈ $0.029 | ≈ $0.05–0.08 |

A visit is 12–18 business messages end to end (invite, slot list, confirmation, two reminders, post request, disclosure check, thanks). Call it **£0.30–0.60 per visit**, so under £3 per venue per month against a £299 subscription. Messaging cost is not a factor. Going direct to Meta's Cloud API (as this code does) avoids the $0.003–0.01 per-message BSP markup; a BSP such as 360dialog or Infobip is still worth it if you want their inbox and number hosting in the UAE.

**UAE specifics.** WhatsApp *calls* are blocked in the UAE; text, voice notes and media are fully available and the Business API is legal through Meta or a licensed BSP. You will want a UAE number for the Dubai WABA (creators trust +971 more than +44) and to respect the UAE PDPL alongside UK GDPR/PECR. Explicit consent is captured as the very first step of onboarding in both markets.

---

## 3. What changes for the UK and for Dubai

Everything market-specific is a single table in `src/domain/markets.ts`. The substantive differences:

### Pricing and positioning

| | UK | Dubai |
|---|---|---|
| Suggested price | **£299 / month** (ex VAT). Joli, the incumbent UK hospitality creator platform, lists £299 as its base plan; matching it and selling "autopilot, not a marketplace" is the cleanest pitch. | **AED 1,499 / month** (~£300). Dubai venues are used to *free* barter marketplaces (Fleek Dubai, Barter), so the sale is reliability, permit-compliance and zero admin, not access. Consider AED 1,999 for licensed / hotel venues. |
| Comped meal norm | £50–80 for two. London creators above ~20k followers increasingly expect a fee on top; keep v1 to nano/micro creators and let venues add a cash top-up as a paid tier later. | AED 250–400 for two; brunch culture makes weekend slots the premium inventory. |
| Market size | ~29k full-service restaurants, ~50k takeaways, ~99k licensed premises. Over 80% independently owned. Start in London (Shoreditch, Hackney, Soho, Brixton), then Manchester. | ~13,000+ licensed F&B outlets, 1,200+ new applications per half-year, dense and heavily influencer-driven. Start in JLT / Marina / Business Bay / Downtown. |
| Incumbents | Joli (£299+, ~6–10k creators, 48 cities), Sup, IQFluence, food agencies (Takumi, Goat, Billion Dollar Boy). | Fleek Dubai (free, venue does the work, contact via WhatsApp), Impacto (barter-first agency), Barter, plenty of one-person agencies. |

### Compliance (this is where the two markets really differ)

**United Kingdom**
- **Disclosure.** ASA / CAP Code and the CMA's endorsement guidance require gifted content to be labelled as an ad, upfront, before the venue is named. "#gifted" alone is not enough; "#ad" or "Ad – gifted" is. The engine reminds the creator at booking, again at post-request time, and asks them to confirm the label before the post is counted. The CMA now has direct fining powers under the DMCC Act.
- **Tax.** HMRC treats barter as income at market value for the creator (above the £1,000 trading allowance) and has been issuing VAT assessments to businesses that "gift" to influencers in return for promotion. Venues should treat the comped meal as a supply for consideration. Put this in the venue T&Cs and give creators an annual statement of meal value.
- **HFSS.** From 2026 the UK restricts paid online advertising of less-healthy food, but the restriction applies to businesses with 250+ employees, so independent venues are out of scope. Chains are not.

**United Arab Emirates**
- **Advertiser Permit.** Since 1 February 2026 anyone publishing promotional content from within the UAE, paid or gifted, needs a UAE Media Council advertiser permit (free for the first three years for citizens and residents; fines up to AED 5,000 and account / visa complications for posting without one). Onboarding asks for it, matching **excludes creators until the permit is verified**, and we tell the creator that plainly. This is a moat: a compliant pool is what venues cannot assemble themselves.
- **Disclosure.** Posts must be clearly marked as ads. Same "#ad" first-frame rule.
- **Tax.** Under FTA Public Clarification VATP042 (2025) barter is a taxable supply for both parties. Registered creators (AED 375k threshold) and venues must invoice the value of the exchange. Same annual statement approach.
- **Content norms.** Alcohol may not be promoted; the `no_alcohol` creator preference and `licensed` venue tag exist so matching never sends a creator who avoids licensed venues to one, and venue guidelines should tell creators not to feature alcohol. Halal-only matching is a first-class filter. Ramadan hours and the Saturday–Sunday weekend are handled by venue hours rather than hard-coded.
- **Messaging.** TDRA: explicit opt-in, no unsolicited campaigns, no late-night sends (enforced).

### Creator supply

Both markets have deep pools of nano food creators. The UK pool is used to gifting and expects professional handling (fast replies, clear labelling rules). Dubai has an even stronger foodie-influencer culture, but the permit requirement will filter the pool sharply in 2026; recruiting *through* the permit (help creators apply, then verify) turns friction into loyalty. Recruit via Instagram DMs to creators already tagging local venues, and via click-to-WhatsApp ads, which open a 72-hour free conversation window.

---

## 4. What is in this folder

```
src/
  domain/
    types.ts        Creator, Restaurant, Match, Booking, Post, ConversationState
    markets.ts      UK and AE rules: currency, tz, send window, disclosure copy, permit rule, VAT
    matching.ts     hard exclusions + weighted score; open-slot accounting per venue per month
    slots.ts        venue hours -> concrete bookable instants in the venue's time zone
    geo.ts          tiny gazetteer (swap for postcodes.io + a Dubai community lookup)
    intent.ts       closed intent set; rule parser + optional Claude structured-output parser
  whatsapp/
    types.ts        transport-neutral message shapes + WhatsApp UI limits
    templates.ts    the five Meta templates to submit, with categories
    cloudApi.ts     Graph API send, webhook verify, signature check, webhook parser
    simulated.ts    in-memory transport for tests and the demo
  services/
    engine.ts       the creator-facing agent (state machine) + 24h-window / quiet-hours logic
    scheduler.ts    the autopilot: expire, fill, remind, collect posts, nudge, mark late
  store/memory.ts   repository interface (in-memory; Postgres next)
  server.ts         Fastify: /webhooks/whatsapp, /restaurants, /scheduler/tick, /restaurants/:id/report
scripts/demo.ts     London + Dubai end-to-end transcript
tests/              24 tests
```

**The creator's experience, as built:**

```
creator: hi
bot:     Hi! This is Nearby. We book local food creators into restaurants near them
         for a comped meal, in exchange for one honest post. Can we message you here
         about visits, bookings and reminders?         [Yes, count me in] [No thanks]
…name → handle → location pin or area → cuisines → dietary → (UAE: permit) …
bot:     You are in, Priya. Invites come one at a time, within about 8km of E2.
         Accept, pick a time, eat, post, done.

(scheduler) 🍽️ Bao Corner · Shoreditch · Taiwanese. They would host you for a
         £60.00 meal for 2, in exchange for one instagram post. Spot held for 24h.
                                                        [Accept] [Decline]
creator: [Accept]
bot:     Great for Bao Corner. Pick a slot (table for 2):   (Choose a time) Wed 9 Sept 19:00 | …
creator: picks Thu 10 Sept 19:00
bot:     Booked: Bao Corner, Thu 10 Sept, 19:00, table for 2 under "Priya" … UK rules: … "#ad" …
venue:   📨 Nearby booking: Priya (@priya.eats) is coming on Thu 10 Sept, 19:00, table for 2.
(day before, silent > 24h → template) 📨 Reminder: you are booked at Bao Corner …  [confirm] [reschedule]
(4h after) Hope you enjoyed Bao Corner! When your post is live, send the link here …
creator: up now https://www.instagram.com/reel/C9abc/
bot:     Quick check: does the post carry "#ad" at the start of the caption?  [Yes it does] [Not yet]
```

**What the matcher does** (`rankCreators`): excludes on market, status, consent, UAE permit, venue follower minimum, distance vs the creator's own radius, halal / no-alcohol / veggie compatibility, an open invite or booking at the venue, a decline or expiry at the venue this month, a visit within 180 days, and the creator's monthly cap. It then scores proximity (40), cuisine match (30), reliability (20), a rotation bonus for creators with nothing yet this month (10), minus 5 per late post. Every exclusion carries a human-readable reason, which is what an ops dashboard needs.

**What the autopilot does** (`tick`): releases expired invites and re-offers the slot to the next candidate; fills each venue's remaining slots for the month, one live invite per creator at a time; sends 24h and 2h reminders (2h ignores quiet hours because the creator is about to eat there); asks for the post 3h after the visit, nudges at 72h intervals twice, then records a late post against reliability.

**Learning from declines:** "Too far" tightens the creator's radius to that distance; "Not my food" removes that cuisine from their list. Small, but it is the same feedback loop TryNearby describes.

**Using Claude for free text.** With `ANTHROPIC_API_KEY` set, messages the rule parser cannot place ("cant do tues, thurs works?") go to `claude-opus-5` with a structured-output schema so the result is always one of the fixed intents. Without a key the rule parser runs alone and every test still passes. Refusal fallbacks are not enabled on that call; add `fallbacks` if you switch the parser to `claude-fable-5-1`.

---

## 5. What is deliberately not built yet

- **Persistence.** In-memory store behind a repository interface. First real change: Postgres with the same six tables.
- **Restaurant side.** A JSON endpoint and a report endpoint exist; there is no dashboard, billing (Stripe with GBP and AED prices), or venue-side WhatsApp thread beyond booking notifications.
- **Post verification and metrics.** The creator confirms the link and the disclosure; nobody fetches the post. TryNearby's clipping background is exactly this piece: scrape views, verify the label in the first frame, aggregate into the venue report. Instagram's Graph API needs the creator to connect their account; TikTok's Display API likewise.
- **Ops inbox.** `HELP` promises a human; there is no handoff. A BSP inbox or a small internal tool reading the same store will do.
- **Geocoding.** Static gazetteer; wire postcodes.io (UK) and a Dubai community list.
- **Arabic templates.** All copy is English; Dubai's creator pool is largely English-first but Arabic templates should be submitted for the invite and reminder.

---

## 6. A 90-day plan

1. **Weeks 1–2.** Meta Business verification, one WABA with a UK and a UAE number, submit the five templates in `templates.ts`. Postgres, Stripe, a one-page venue signup. Recruit 40 creators per city by DM from venues' tagged posts.
2. **Weeks 3–6.** 10 founding venues in each city at half price for a written case study. Fill rate, show rate and post rate are the only three numbers that matter; target 90% / 85% / 80% with median time-to-post under 5 days.
3. **Weeks 7–12.** Post metrics scraping and the venue report. Raise to full price for new venues. Add a cash top-up tier for creators above 20k followers. Decide Manchester vs Abu Dhabi as city three from the data.

Decision points to revisit: whether Dubai venues will pay at all against free marketplaces (the founding-venue cohort answers this), and whether UK creators above nano scale accept meal-only (they may not; the top-up tier is the hedge).

---

## Sources

- TryNearby: [trynearby.com](https://trynearby.com/), [YC company page](https://www.ycombinator.com/companies/trynearby), [creator signup](https://socal.trynearby.com/), [Dealroom launch coverage](https://dealroom.co/news/talk-lSG0v1MNwik-trynearby-launches-local-creator-marketing-platform/), [Brad Flora's post](https://x.com/bradflora/status/2089476200171462987), [FoodFluence comparison](https://www.foodfluence.ai/compare/trynearby), [California Restaurant Association listing](https://web.calrest.org/bg-prod/Advertising-Services/TryNearby-42580), founder LinkedIn profiles ([Yousef Abdelfattah](https://www.linkedin.com/in/faze-apex-b0906b336/), [Ahmad Ibrahim](https://www.linkedin.com/in/ahmibrahim97/)), [Replit video on the first restaurant close](https://www.facebook.com/replit/videos/faze-apex-obaida-albaroudi-closed-trynearbys-first-restaurant-before-the-product/1035652366054272/).
- WhatsApp platform: [Meta pricing docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [messaging policy](https://business.whatsapp.com/policy), [2026 per-message pricing guides](https://blueticks.co/blog/whatsapp-business-api-pricing-2026), [October 2026 service-message change](https://sendpulse.com/blog/whatsapp-service-message-pricing), [general-purpose chatbot ban](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban), [TechCrunch on the terms change](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/), [UAE API use and TDRA rules](https://www.messagecentral.com/blog/whatsapp-business-api-uae), [UAE VoIP block](https://adjoltz.com/blog/is-whatsapp-blocked-in-dubai/), [WhatsApp penetration stats](https://www.infobip.com/blog/whatsapp-statistics).
- UK rules and market: [CMA/ASA influencer guidance update](https://www.rpclegal.com/snapshots/advertising-and-marketing/winter-2025/cma-and-asa-publish-updated-influencer-guidance-on-social-media-endorsements/), [ASA influencer advice](https://www.asa.org.uk/news/like-follow-and-subscribe-to-our-influencer-marketing-advice.html), [HMRC VAT on gifts to influencers](https://www.rsmuk.com/insights/tax-voice/hmrc-vat-crackdown-on-gifts-to-social-media-influencers), [influencer barter tax](https://www.theaccountancy.co.uk/self_employed/the-influencers-guide-to-payments-in-kind-and-tax-on-gifts-247763.html), [HFSS 2026](https://joliapp.com/blog/hfss-lhf-online-food-advertising-restrictions-2026-uk-hospitality/), [IBISWorld UK full-service restaurants](https://www.ibisworld.com/united-kingdom/number-of-businesses/full-service-restaurants/3420/), [Joli pricing](https://joliapp.com/pricing/), [UK platform comparison](https://sup.co/blog/best-influencer-marketing-platforms-2026-honest-comparison).
- UAE rules and market: [UAE Media Council advertiser permit](https://www.middleeastbriefing.com/news/uae-influencers-must-obtain-advertiser-permit-under-new-media-law/), [permit guide](https://www.meydanfz.ae/blog/new-advertising-permit-for-influencers-uae), [Time Out on the deadline](https://www.timeoutdubai.com/news/uae-media-council-influencer-permit-deadline), [VAT on barter, VATP042](https://www.horizonbizco.com/blog/understanding-barter-transactions-under-uae-vat-law/), [influencer VAT](https://habibalmulla.com/likes-shares-and-taxes-understanding-vat-for-influencer-collaborations/), [Dubai F&B outlet counts](https://gitnux.org/dubai-restaurant-industry-statistics/), [Fleek Dubai](https://fleekdubai.com/), [Impacto](https://impacto.agency/), [Dubai influencer rate guide](https://influencer.vip/blogs/how-much-to-pay-influencers-in-dubai-the-definitive-2026-rate-guide).
