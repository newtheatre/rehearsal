# ADR-0011: The academic year ends 31 August, and an award near the boundary carries over

**Status:** Accepted · **Date:** 2026-08-20 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

`ACADEMIC_YEAR` stamped the next boundary strictly after the award. With a 30 September boundary, an induction taken on 15 September was valid for fifteen days.

That was not treated as a defect. [records-and-expiry.md](../records-and-expiry.md) documented it as the meaning of an academic-year gate, its worked example called fifteen days "correct", and it advised running inductions in October rather than September. `tests/validity.test.ts` asserted it by name.

Two things were wrong with that. Inductions happen when the intake arrives, in late September, so the advice asked the calendar to move rather than the code. And the person trained earliest was penalised most: they got the shortest record and a renewal warning within days of finishing.

Separately, the university's academic year ends on 31 August. A 30 September boundary was never the thing the mode is named after.

## Decision

Three parts, one decision.

The shipped default `academic_year_end` becomes `08-31`. It is defined once, in `shared/utils/configDefaults.ts`, and read from there by `server/utils/expiry.ts`, which previously carried its own duplicate copy of the same literal. It stays operator-tunable through `site_config`.

`nextAcademicYearEnd` carries over: when the boundary it would return is fewer than `ACADEMIC_YEAR_CARRY_OVER_DAYS` after the award, it returns the following one instead. The existing strictly-after rule is untouched and runs first; carry-over is a second step applied to its result.

That threshold is **60 days, a constant and not config**, on the precedent set by `FINAL_WARNING_DAYS`: the warning window is the operator's dial, and a second knob invites the two being set inconsistently. 60 matches the default `warning_window_days`, so under default settings a record is never awarded already inside its own warning window. An operator who raises the warning window reintroduces that overlap; the constant is justified against the default, not against every setting.

**This reverses the position stated in records-and-expiry.md.** It does not supersede [ADR-0002](0002-expiry-stamped-at-award.md), whose decision is untouched: expiry is still computed once at award and stored, validity is still derived, and the admin recalculation is still the only retroactive path. ADR-0002's consequences mention "the 1 October induction rollover", which is now 1 September.

Carry-over does not make `ACADEMIC_YEAR` a duration. Records still expire on a shared fixed boundary. Carry-over only chooses which boundary.

## Alternatives considered

**Keep the fixed boundary and schedule around it.** The status quo. Rejected because it made a specification document give scheduling advice to work around its own arithmetic, and because it charged the earliest trainees the most.

**Move the boundary to 31 August and stop there.** Fixes the September case, which is the common one, but leaves late-August training expiring within days. Given the boundary move is what creates that new edge, shipping it without carry-over would have traded one cliff for another.

**Make the carry-over window configurable.** Rejected on the `FINAL_WARNING_DAYS` precedent. It is a second dial that can be set inconsistently with the warning window, and it would make expiry semantics differ per install in a system whose semantics are a published contract that consumers compile against.

**Make `ACADEMIC_YEAR` a rolling twelve months.** Solves the cliff completely and loses the common renewal date, which is the entire reason the mode exists rather than `MONTHS`.

**Special-case induction.** Module policy belongs in the catalogue, not in code.

## Consequences

Good: no academic-year award is ever worth less than 60 days. September inductions, which is when induction actually runs, now behave sensibly. The boundary has one definition, so the next change to it is a one-line diff rather than two files that can disagree.

Bad: an award may now run to about 425 days, so "everyone renews together" becomes "everyone renews together, except those trained in the run-up, who renew a year later". The mass rollover moves to 1 September and the late cohort is not in it. `expires_at` is no longer a pure function of the boundary and the award year.

Operationally: existing records keep their stamped dates until an explicit recalculation, per ADR-0002. That run is safe when it lengthens records and dangerous when it shortens them. Moving the boundary earlier shortens every academic-year expiry by thirty days, so **a recalculation run between 1 and 30 September would expire the estate's inductions on arrival**. Preview the diff and read the dates before confirming, and prefer running it outside that window.
