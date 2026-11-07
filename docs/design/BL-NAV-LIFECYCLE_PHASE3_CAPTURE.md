# Phase 3 — Capture: design for review

**Status:** approved by the owner (2026-11-07) with every recommended answer in §4: federal sources now and state / local later; partners answer through an emailed link with no account; partners see the questions and their own answers only; a PARTNER opportunity may move to Plan with "agreement: to do" until phase 8.
**Requirements:** FORGE II footnote 6, C-1 to C-7 and C-11 in
`docs/FORGE_II_REQUIREMENTS.md` (C-8 to C-10, agreements and signature,
are phase 8). **Plan:** BL-NAV-LIFECYCLE phase 3.

## 1. What FORGE already has

| Piece | Where today | What it gives Capture |
|---|---|---|
| The decision | Evaluate (2a) | Which opportunities are GO and which are PARTNER, with the gaps that made them PARTNER |
| The capability matrix | Capability tab (2b) | The exact questions a partner must answer, with the company's own answers to compare against |
| Matrix and Analysis Reports | 2b-2, 2c | The evidence to share with a partner and to keep with the decision |
| Your partners | Companies (teaming partner / subcontractor) | The first list (already suggested on PARTNER, 2a) |
| SAM.gov entity search | Company search (`searchSamGovEntities`) | Every registered federal contractor by NAICS, name, UEI, CAGE |
| Certification registry | Firms (`cert_firm`: 8(a), HUBZone, WOSB, EDWOSB, SDVOSB, VOB, Native American) | Socio-economic status, kept current by the cert import |
| Award history | USAspending (`searchAwardsByCriteria`) | Who won what, where, under which NAICS: real past performance |

**What's missing:** a Capture page built around GO / PARTNER, one partner
database that joins those sources, the AI's ranked shortlist with reasons,
inviting partners to answer the matrix, the side-by-side view, and the
step to Plan.

## 2. The design

### 2.1 The Capture page (C-1)

**Pipeline → Capture** lists every opportunity decided GO or PARTNER
(stage Qualified). One row each:
- the decision;
- days left;
- for PARTNER: partners invited / answered / chosen;
- the next step: *Find partners*, *Invite*, *Compare answers*, *Choose a partner* or *Move to Plan*.

### 2.2 The partner database (C-2)

One search across the sources above, joined by UEI:
- **SAM.gov entities**, registered and active: name, UEI, CAGE, NAICS codes, location;
- **certifications** from the cert registry (8(a), HUBZone, WOSB, SDVOSB and others);
- **past performance** from USAspending: awards under the opportunity's NAICS, at its agency, in the last five years, with value;
- **your own record**: whether they are already in Companies, and how past teaming went.

ISO / CMMI / CMMC aren't in any federal registry. They come from the partner's own answers (2.4) and from what you record on the company.

### 2.3 FORGE AI finds partners (C-3, C-4)

**Find partners** on a PARTNER opportunity:
- takes the matrix's **No** and **Partial** answers (the gaps), the NAICS, the set-aside and the place of performance;
- searches the database;
- has the AI rank the best 10 with a reason each, for example: *"Holds the 541519 awards at VA you lack; SDVOSB, which keeps the set-aside; based in Maryland."*

Every reason must cite a fact the search returned. **Find more** widens the search (more NAICS codes, a wider area) on request. Adding a partner from the list puts it in Companies as a teaming partner or subcontractor.

### 2.4 Invite partners to the matrix (C-5, C-6)

**Invite** sends a partner contact a link by email. The link:
- is personal, works without a FORGE account, and expires in 14 days;
- opens the same capability matrix: the questions only, never your answers;
- lets the partner answer Yes / Partial % / No with evidence, add its certifications (ISO, CMMI, CMMC levels), and submit.

The partner sees and edits only its own answers. **Compare** on the opportunity shows your answers and every partner's side by side, per requirement, and highlights which partner closes which gap.

### 2.5 FORGE AI rates the partners (C-7)

Once answers arrive, the AI scores each partner on how many of your gaps it closes (weighted like coverage), its evidence and its certifications, and recommends them in order with the reason. The recommendation is advice: you choose.

### 2.6 Choose and move to Plan (C-11)

**Choose partner** records the choice (kept, like the decision) and marks the opportunity *partner chosen*. **Move to Plan** is then offered. A GO opportunity needs no partner and can move to Plan at once.

The agreement (teaming agreement or subcontract, redlines, e-signature) is phase 8. Until then, Capture records "agreement: to do" and does not block Plan.

## 3. Delivery (one PR each)

1. **3a:** the Capture page, *Choose partner* and *Move to Plan*, and the partner database search (SAM.gov + certifications + USAspending + Companies).
2. **3b:** the AI's ranked partner list, with *Find more*.
3. **3c:** invitations, the partner's own matrix page, *Compare*, and the AI's partner rating.

## 4. Decisions for the owner

1. **State and local partners (C-2).** Start with federal sources (SAM.gov, the cert registry, USAspending) and add state and local registries later, one at a time, as you name them? (Recommended.)
2. **Partner access (C-5).** A personal emailed link with no account, expiring in 14 days (recommended, so partners need no sign-up)? Or partners create a FORGE account?
3. **What partners see.** Only the questions and their own answers (recommended)? Or also your requirement references and Section L/M notes?
4. **Moving to Plan without an agreement.** Allow it until the agreement module (phase 8) exists, with "agreement: to do" shown (recommended)? Or hold PARTNER opportunities in Capture until an agreement is uploaded?
