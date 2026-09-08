# Slice 5 UI framework selection

## Bottom line

The primary-source comparison initially favored **React Aria Components** on architectural fit. The subsequent Slice 5 Grill selected **AI Elements + shadcn/ui in a thin-adaptation mode** because the product priority is a current, familiar AI Conversation experience with lower initial UI construction cost. CMaster still owns Feature components, View Models, Snapshot/sequence recovery, and Domain semantics; AI Elements is a presentation source, not the Message/Run state owner.

AI Elements officially describes itself as a composable AI application component library built on shadcn/ui, with streaming and AI SDK type alignment, source-code installation, and an accessibility/theme baseline. (https://ai-sdk.dev/elements/llms.txt; https://www.npmjs.com/package/ai-elements; https://github.com/vercel/ai-elements)

## General UI framework comparison

### AI Elements + shadcn/ui
- **Version / delivery:** the `ai-elements` package is a CLI/custom registry; installation adds selected component source and dependencies to the application rather than hiding implementation in a runtime package. (https://www.npmjs.com/package/ai-elements; https://ai-sdk.dev/elements/llms.txt)
- **AI interaction fit:** official docs provide composable Conversation, Message, Prompt Input, Tool and other AI-specific components, streaming support, and props aligned with AI SDK types such as `UIMessage`. (https://ai-sdk.dev/elements/llms.txt)
- **Foundation:** AI Elements is built on shadcn/ui and inherits its theme conventions; this gives a current visual starting point but couples presentation to that source/styling ecosystem. (https://ai-sdk.dev/elements/llms.txt; https://ui.shadcn.com/)
- **Fit for CMaster-owned state:** good only in thin-adaptation mode. Source components can receive CMaster presentation props, but the documented `useChat` flow cannot own CMaster's separately durable Message, Run, Approval, Artifact, Snapshot, and sequence recovery semantics. (https://ai-sdk.dev/elements/llms.txt)

### React Aria Components
- **Version / maturity:** 1.21.1; peers React/React DOM `^19.0.0-rc.1` and depends on `client-only`, so it is already aligned with React 19-era app routing but is still fundamentally a client-side UI layer. (https://registry.npmjs.org/react-aria-components/latest)
- **A11y / keyboard:** official docs say React Aria has built-in screen reader support, keyboard navigation, correct semantics, focus handling, and announcements. (https://react-spectrum.adobe.com/react-aria/accessibility.html)
- **Theming / tokens / styling:** style-free by default; styling docs call out class names, states, render props, slots, CSS variables, and Tailwind CSS as supported styling paths. That keeps app-owned tokens and view models outside the library. (https://react-aria.adobe.com/; https://react-aria.adobe.com/styling)
- **i18n / RTL:** docs say it includes localized strings for 30+ languages, locale-aware dates/numbers, and RTL interactions; `useLocale` exposes locale plus layout direction. (https://react-spectrum.adobe.com/react-aria/accessibility.html; https://react-aria.adobe.com/useLocale)
- **SSR / App Router:** the docs include `frameworks`, `SSRProvider`, `useIsSSR`, and `useId` with SSR support; the framework guide explicitly includes Next.js. (https://react-aria.adobe.com/frameworks; https://react-aria.adobe.com/SSRProvider; https://react-aria.adobe.com/useIsSSR)
- **Virtualized long lists:** there is a first-party `Virtualizer` package for list/grid/waterfall/infinite layouts, and release notes call Virtualizer GA. (https://react-aria.adobe.com/Virtualizer; https://react-aria.adobe.com/releases/v1-21-0)
- **Fit for CMaster-owned features/view models:** very strong. The library is intended to be composed and styled by the app, not the other way around. (https://react-aria.adobe.com/styling)

### Base UI
- **Version / maturity:** 1.0.0-rc.0; peers React/React DOM `^17 || ^18 || ^19`. This is the least mature option in the set. (https://registry.npmjs.org/@base-ui-components/react/latest)
- **A11y / keyboard:** docs say Base UI components handle ARIA/role attributes, pointer interactions, keyboard navigation, and focus management, and are tested across browsers/devices/screen readers; the accessibility page says it follows WAI-ARIA APG and WCAG 2.2. (https://base-ui.com/react/overview/accessibility; https://base-ui.com/react/overview/accessibility)
- **Theming / tokens / styling:** the docs call Base UI unstyled, with no bundled CSS and no prescribed styling solution; it works with Tailwind, CSS Modules, CSS-in-JS, plain CSS, and other styling libraries. That is good for project-owned tokens and wrapper components. (https://base-ui.com/; https://base-ui.com/react/overview/quick-start)
- **i18n / RTL:** `DirectionProvider` enables RTL behavior, but the docs also say `dir="rtl"` or CSS `direction: rtl` must be set separately. I did not find a first-party locale/i18n guide in the docs index I checked. (https://base-ui.com/react/utils/direction-provider; https://base-ui.com/llms.txt)
- **SSR / App Router:** I did not find first-party Next.js/App Router or RSC guidance in the docs index/pages I checked. (https://base-ui.com/llms.txt; https://base-ui.com/react/overview/quick-start)
- **Virtualized long lists:** I did not find a first-party virtualizer in the docs index/pages I checked. (https://base-ui.com/llms.txt)
- **Fit for CMaster-owned features/view models:** strong from a styling-seam perspective, but the RC status makes it a riskier core choice than React Aria. (https://base-ui.com/react/overview/quick-start; https://registry.npmjs.org/@base-ui-components/react/latest)

### HeroUI
- **Version / maturity:** 3.2.4; peers `react >=19`, `react-dom >=19`, and `tailwindcss >=4`. Stable release, but much more opinionated about the stack. (https://registry.npmjs.org/@heroui/react/latest)
- **A11y / keyboard:** the docs say HeroUI is built on React Aria Components, with focus management, keyboard navigation, and screen reader support. (https://heroui.com/docs)
- **Theming / tokens / styling:** HeroUI uses CSS variables and BEM classes for theming, and its web library combines React Aria Components with Tailwind CSS v4. That is a strong design-system story, but it couples the app to HeroUI/Tailwind conventions. (https://heroui.com/docs/customization/theme; https://heroui.com/docs)
- **i18n / RTL:** release notes for v3.1.0 call out RTL layout refinements, logical CSS properties, and RTL fixes for table corners and picker/menu indicators. (https://heroui.com/en/docs/react/releases/v3-1-0)
- **SSR / App Router:** the theme docs show a Next.js App Router `Providers` example that uses `ThemeProvider` from `next-themes` and requires `"use client"`; the v3.1.0 release notes also mention `useTheme` SSR fixes. (https://heroui.com/docs/customization/theme; https://heroui.com/en/docs/react/releases/v3-1-0)
- **Virtualized long lists:** Table docs say virtualization is supported through `Virtualizer`. (https://heroui.com/docs/components/table#virtualization)
- **Fit for CMaster-owned features/view models:** usable, but it is the most coupled to an opinionated styling stack here, so domain-owned wrappers would have to work harder to keep Tailwind/theme concerns out of feature code. (https://heroui.com/docs; https://heroui.com/docs/customization/theme)

### Mantine
- **Version / maturity:** 9.6.0; peers `react ^19.2.0` and `@mantine/hooks 9.6.0`. Stable and active. (https://registry.npmjs.org/@mantine/core/latest)
- **A11y / keyboard:** Mantine says components follow WAI-ARIA, provide proper roles/aria attributes, full keyboard support, correct focus management, and screen reader support; accessibility tests use axe/jest-axe and keyboard tests. (https://mantine.dev/llms/q-are-mantine-components-accessible.md)
- **Theming / tokens / styling:** MantineProvider injects CSS variables and manages color scheme; Mantine supports light/dark/auto color schemes, and the docs explain that custom color schemes are not supported—theme customization is the route for custom colors. (https://mantine.dev/theming/mantine-provider/; https://mantine.dev/llms/q-light-dark-is-not-enough.md)
- **i18n / RTL:** all components support RTL out of the box; `DirectionProvider` is used to set direction and the root `dir` attribute is required/detected. (https://mantine.dev/llms/styles-rtl.md)
- **SSR / App Router:** Mantine has explicit Next.js guidance, including App Router examples, `ColorSchemeScript`, and a note that SSR/SSG needs correct color-scheme setup to avoid flicker. (https://mantine.dev/guides/next/; https://mantine.dev/llms/q-color-scheme-flickering.md)
- **Virtualized long lists:** I did not find a first-party virtualized-list API in the core docs/readme pages I checked. (https://mantine.dev/llms.txt; https://registry.npmjs.org/@mantine/core/latest)
- **Fit for CMaster-owned features/view models:** workable, but Mantine’s core theme/color-scheme model is more opinionated than a headless primitive layer; the headless mode exists, but it disables several style-related capabilities and some components become unusable. (https://mantine.dev/llms/styles-unstyled.md)

## Final Slice 5 decision

Use selected **AI Elements + shadcn/ui** source components for Conversation, Message, Prompt Input, Tool, and Confirmation presentation. Keep imported source close to upstream and adapt it through props, classes, CSS variables, semantic tokens, and an external CMaster projection adapter. Do not let default `useChat` orchestration merge the separately durable Message and Run lifecycles; do not expose raw Chain-of-Thought/Provider reasoning; and do not reuse Attachment, Artifact, Tool, or Confirmation names as CMaster Domain types.

Use React Aria's documented capabilities as a benchmark for required keyboard, focus, i18n/RTL, and virtualization behavior, but do not add a second general UI framework without a demonstrated component gap.

## Main risks

1. **Registry source upgrades.** AI Elements is delivered as source, so even thin adoption retains some upgrade cost.
2. **Semantic mismatch.** AI SDK-aligned props do not prove CMaster's Snapshot/sequence recovery, immutable Approval Subject, uncertain Tool outcome, or exact Artifact Version semantics; project tests remain authoritative.
3. **Accessibility gap.** An upstream baseline does not replace CMaster's WCAG 2.2 AA, keyboard, focus, reduced-motion, and Playwright axe gates.
4. **Local divergence.** Heavy local edits make upgrades costly; components requiring substantial semantic changes become explicitly CMaster-owned Feature components.
