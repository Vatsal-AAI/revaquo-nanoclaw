---
name: deep-research
description: Multi-source deep research using web search and crawling. Searches the web, synthesizes findings, and delivers cited reports with source attribution. Use when the user wants thorough research on any topic with evidence and citations.
---

# Deep Research

Produce thorough, cited research reports from multiple web sources.

## When to Activate

- User asks to research any topic in depth
- Competitive analysis, technology evaluation, or market sizing
- Due diligence on companies, investors, or technologies
- Any question requiring synthesis from multiple sources
- User says "research", "deep dive", "investigate", or "what's the current state of"

## Workflow

### Step 1: Understand the Goal
Ask 1-2 quick clarifying questions:
- "What's your goal -- learning, making a decision, or writing something?"
- "Any specific angle or depth you want?"
If the user says "just research it" -- skip ahead with reasonable defaults.

### Step 2: Plan the Research
Break the topic into 3-5 research sub-questions.

### Step 3: Execute Multi-Source Search
For EACH sub-question, search using available tools (WebSearch, WebFetch):
- Use 2-3 different keyword variations per sub-question
- Mix general and news-focused queries
- Aim for 15-30 unique sources total
- Prioritize: academic, official, reputable news > blogs > forums

### Step 4: Deep-Read Key Sources
For the most promising URLs, fetch full content. Read 3-5 key sources in full for depth. Do not rely only on search snippets.

### Step 5: Synthesize and Write Report
Structure: Executive Summary, Major Themes (with inline citations), Key Takeaways, Sources, Methodology.

### Step 6: Deliver
- Short topics: Post the full report in chat
- Long reports: Post executive summary + key takeaways, save full report to a file

## Parallel Research with Subagents
For broad topics, use Task tool to parallelize across 3 research agents.

## Quality Rules
1. Every claim needs a source. No unsourced assertions.
2. Cross-reference. If only one source says it, flag it as unverified.
3. Recency matters. Prefer sources from the last 12 months.
4. Acknowledge gaps.
5. No hallucination. If you don't know, say "insufficient data found."
6. Separate fact from inference.
