---
kind: mindgraph.authoring
version: 1
title: Recursive Self-Improvement
runtime: ../out/recursive-self-improvement.mindgraph.json
---

# Sources

@source rsi-note
type: text
title: Recursive Self-Improvement Notes
path: ../../transcripts/recursive-self-improvement.txt

# Source Blocks

@block b001 source=rsi-note kind=heading
Recursive Self-Improvement

@block b002 source=rsi-note kind=paragraph
Recursive self-improvement is a feedback process where improved capability increases the ability to improve further.

# Reader Steps

@step s001 section=setup blocks=b001,b002
summary: The source introduces recursive self-improvement as a capability feedback loop.
focus:
  - recursive-self-improvement 0.95 explicit
  - feedback-loop 0.80 explicit
relations:
  - recursive-self-improvement -> feedback-loop depends_on 0.85

# Sections

@section setup
title: Setup: improvement as feedback
summary: The opening step frames recursive self-improvement as a feedback loop.
steps: s001

# Concepts

@concept recursive-self-improvement
label: Recursive Self-Improvement
aliases: RSI
cluster: ai-capability-growth
first_seen: b002

@concept feedback-loop
label: Feedback Loop
cluster: systems-dynamics
first_seen: b002

@cluster ai-capability-growth
label: AI Capability Growth
children: recursive-self-improvement

@cluster systems-dynamics
label: Systems Dynamics
children: feedback-loop

# Relations

@relation rsi-depends-on-feedback
from: recursive-self-improvement
to: feedback-loop
type: depends_on
provenance: source
grounded_in: b002
