# TaleForge Genre Intelligence Architecture

TaleForge separates narrative concerns so no single genre system becomes a catch-all.

## Layers

1. Genre Intelligence — defines what kind of story it is: fantasy, science fiction, mystery, horror, romance, military, war, cultivation, wuxia, xuanhuan, isekai, reincarnation, regression, transmigration, system, progression fantasy, LitRPG, academy, dungeon, apocalypse, time loop, historical, political intrigue, revenge, family drama, slice of life, comedy, sports, and extensible future categories.
2. Narrative Tradition Intelligence — defines structural conventions associated with broad storytelling traditions such as Japanese light-novel, Chinese web-serial, Korean web-novel, Western epic fantasy, and progression fantasy. It never imitates individual authors.
3. Narrative Mode Intelligence — defines the mechanics of progression, mystery revelation, character growth, military campaigns, political games, survival escalation, relationship evolution, and time causality.
4. Trope Intelligence — identifies reusable narrative devices and requires originality-preserving transformations.
5. Hybrid Story Engine — combines compatible genres, traditions, modes, and tropes into structural strategies.
6. Story Opportunity Intelligence — future layer that searches the combination space for underused or novel story opportunities.
7. Story DNA / Identity / Blueprint / Arc / Depth — converts the selected strategy into a specific original story architecture.
8. Generation Context — eventually carries the selected narrative profile into chapter planning and generation.

## Core rule

Genre answers "what kind of story?".
Tradition answers "which broad storytelling conventions can shape it?".
Narrative mode answers "what mechanism drives it?".
Tropes answer "which narrative devices are useful?".
Hybrid strategy answers "how do these pieces interact in this particular series?".

These systems must remain distinct but connected through governed dependencies.

## Originality

Profiles are high-level structural conventions, not author imitation. Every generated series must preserve story-specific originality, avoid text reuse, and allow intentional inversion or recombination of familiar tropes.

## Current implementation

- Genre taxonomy tables created and seeded.
- Narrative modes seeded.
- Trope library seeded.
- Hybrid recipe storage created.
- Series genre profile storage created.
- Deterministic narrative-profile selection engine created.
- Five current production series received canonical-signal-based selections.
- Governance registry/dependencies added.
- Existing narrative depth plans remain architectural scaffolds and must not be treated as generated story content.

## Future expansion

The taxonomy is deliberately data-driven. Adding a genre, subgenre, cultural tradition, trope family, or hybrid recipe should not require rewriting the generation engine. New combinations can therefore produce genuinely different story architectures rather than merely changing prose style.
