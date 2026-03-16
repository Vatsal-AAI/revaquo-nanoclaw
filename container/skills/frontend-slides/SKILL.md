---
name: frontend-slides
description: Create animation-rich HTML presentations from scratch or by converting PowerPoint files. Zero dependencies, one self-contained HTML file.
---

# Frontend Slides

Create zero-dependency, animation-rich HTML presentations that run entirely in the browser.

## Non-Negotiables
1. Zero dependencies: one self-contained HTML file with inline CSS and JS.
2. Viewport fit is mandatory: every slide must fit inside one viewport with no internal scrolling.
3. Show, don't tell: use visual previews instead of abstract style questionnaires.
4. Distinctive design: avoid generic purple-gradient, Inter-on-white, template-looking decks.
5. Production quality: keep code commented, accessible, responsive, and performant.

## Workflow
1. Detect Mode (new / PPT conversion / enhancement)
2. Discover Content (purpose, length, content state)
3. Discover Style (visual exploration with 3 single-slide previews)
4. Build the Presentation (semantic structure, CSS custom properties, presentation controller, Intersection Observer animations, reduced-motion support)
5. Enforce Viewport Fit (hard gate -- `height: 100vh; 100dvh; overflow: hidden`, clamp() scaling, split slides when content doesn't fit)
6. Validate (check at 1920x1080, 1280x720, 768x1024, 375x667, 667x375)
7. Deliver (open deck, summarize)

## Content Density Limits
| Slide type | Limit |
|------------|-------|
| Title | 1 heading + 1 subtitle + optional tagline |
| Content | 1 heading + 4-6 bullets or 2 short paragraphs |
| Feature grid | 6 cards max |
| Code | 8-10 lines max |
| Quote | 1 quote + attribution |
| Image | 1 image constrained by viewport |

## PPT/PPTX Conversion
Use python3 with python-pptx for extraction. Preserve slide order, speaker notes, and extracted assets. Then run same style-selection workflow.

## Implementation Requirements
- Inline CSS/JS, fonts from Google Fonts or Fontshare
- Keyboard, touch/swipe, mouse wheel navigation
- Progress indicator
- Semantic structure, readable contrast, prefers-reduced-motion support

## Anti-Patterns
Generic startup gradients, system-font decks, long bullet walls, scrolling code blocks, fixed-height content boxes that break on short screens.
