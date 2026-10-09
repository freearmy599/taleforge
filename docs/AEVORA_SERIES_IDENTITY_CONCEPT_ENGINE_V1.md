# Aevora Series Identity & Concept Engine v1

## Goal

Make autonomous series concepts distinct, legible to readers, sustainable over long serial runs, and safe to produce without spending chapter-generation quota during planning.

This document is an implementation contract, not a claim that every requirement is already implemented or verified.

## Current architecture found in Supabase

The database already contains a substantial story-architecture foundation:
- Opportunity selection with novelty, catalog-gap, serial-sustainability, payoff, and opportunity scores.
- Concept candidates with premise, reader promise, protagonist engine, conflict, world premise, progression/mystery/faction/relationship engines, arc capacity, ending potential, differentiation profile, originality constraints, and safety constraints.
- World architecture, world rules, factions, and world dependencies.
- Major/minor concept arcs, character and relationship functions.
- Story DNA / identity and a subgenre profile selector with primary and secondary subgenre keys.
- A subgenre intelligence integrity check.

Important limitation: the existence of tables/functions is not proof of a mature end-to-end generator. The inspected concept-design function currently seeds several fields with generic scaffolding such as “design_required”, and the arc designer uses reusable generic arc titles. The subgenre selector is largely rule/keyword based. Those are foundations to improve, not evidence that unique 200-chapter narratives are already guaranteed.

## Required series identity contract

Every candidate should have a versioned identity packet before it is eligible for expensive prose generation:

1. **Reader-facing promise**
   - One-sentence hook.
   - Specific emotional payoff and serial question.
   - Intended audience and content boundaries.
   - A concrete reason to read the next chapter.

2. **Genre architecture**
   - One primary genre.
   - One primary subgenre.
   - Zero or more secondary subgenres.
   - Zero or more compatible traditions/influences.
   - Optional hybrid label only when the combination changes story mechanics, not merely because two tags were added.
   - New/custom genre proposal when no catalog entry accurately describes the mechanics; preserve its definition and distinguish it from existing labels.

3. **Originality fingerprint**
   - Protagonist’s unusual starting condition and goal.
   - Central causal conflict.
   - World-specific constraint or cost.
   - Progression/reward loop if relevant.
   - Antagonistic pressure and opposing incentives.
   - Signature mystery or dramatic question.
   - Relationship engine.
   - Expected reader payoff.
   - Explicit “do not repeat” comparisons against existing Aevora series.

4. **Long-serial sustainability**
   - Target range selected by story needs, not a forced fixed count.
   - Major arc map and nested minor arcs.
   - Escalation rules and costs.
   - Mid-series transformations and endgame direction.
   - Thread ledger: setup, owner, planned payoff window, status.
   - Continuity state required between chapters.
   - Anti-padding rule: each chapter must change a meaningful state, advance a thread, deepen a character/relationship, or deliver a planned payoff.

5. **Visual identity brief**
   - Three to five motifs drawn from the approved world and premise.
   - Palette and atmosphere.
   - One composition idea.
   - Cover text hierarchy.
   - Prohibited generic/cliché imagery where it would misrepresent the series.
   - Keep this as metadata for the cover pipeline; never call an image provider during public page rendering.

## Example genre handling

These are supported target patterns, not claims that a specific story has already been generated:

- **Dungeon / monster evolution:** dungeon ecology, creature evolution constraints, territory/resource loop, rival entities, dungeon-origin mystery, and consequences for the outside world.
- **Tower climbing:** distinct floors with rule changes, costs for advancement, competing climbers/factions, durable progression, and a reason the tower exists.
- **Academy progression fantasy:** curriculum and rank rules, institutional incentives, rivalries, mentorship costs, examinations with consequences, and a conflict beyond “win the next test”.
- **Hybrid series:** for example, dungeon progression + political intrigue only when dungeon resources materially change political power and political decisions alter dungeon conditions.
- **Custom genre:** store a concise definition, required mechanics, disallowed misclassification, compatible subgenres, and examples of what makes a series qualify.

## Novel length and 200+ chapter readiness

A series may target 200+ chapters only when the sustainability plan justifies it. Use nested arcs, chapter-level plans, continuity snapshots, character/relationship state, world-state changes, unresolved-thread tracking, and periodic editorial audits. Do not generate all chapters at once. Generation and publication remain separate; chapter release remains controlled by the existing review/release lifecycle.

Recommended validation gates before a concept advances:
- Identity completeness.
- Genre/subgenre compatibility and hybrid rationale.
- Differentiation from existing catalog entries.
- Sustainable arc/payoff map.
- World-rule consistency.
- Safety review.
- No unresolved generic placeholders in required identity fields.
- No external prose imitation; use high-level genre conventions while keeping the plot, cast, world, and expression original.

## Cover generation and quota policy

- Do not use Gemini chapter-generation quota for cover images.
- Before using any image API, inspect the provider's current quota, pricing, response format, and account availability. Do not assume that “free tier” means quota remains.
- Current Aevora cover worker is readiness-only; provider secrets are not configured and review does not yet approve/publish images.
- Cloudflare Workers AI is a candidate adapter documented separately, not a confirmed live provider.
- Keep generated candidates private until validated and explicitly approved by an editor.
- A cover failure must never block story design, chapter generation, editorial review, or publication.

## Safe implementation sequence

1. Add identity-packet validation and explicit placeholder detection.
2. Improve concept fields from generic scaffolding to story-specific metadata supplied by approved opportunity signals and structured design steps.
3. Improve hybrid/new-genre classification and persist its rationale.
4. Add catalog similarity checks against existing Aevora series before approval.
5. Connect identity metadata to cover briefs and the existing CSS cover motif system.
6. Add dry-run fixtures for dungeon/monster, tower, academy, mystery, and hybrid concepts.
7. Verify outputs without triggering production generation, consuming Gemini quota, or publishing chapters.

## Verification status

The current database was inspected for relevant routine definitions. This document records the target design and observed limitations; it does not change database functions, trigger the autonomous creation cron, call an AI provider, generate a cover, or publish content.
