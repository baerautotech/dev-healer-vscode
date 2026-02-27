# Reusable Testing Standard — All Repositories

## Purpose
This document defines the testing configuration and requirements for every
project. It is referenced by agents.md and must be followed for all E2E tests.

---

## 1. Playwright Configuration Requirements

Every project using Playwright MUST use this configuration pattern:

```typescript
// playwright.config.ts — REQUIRED CONFIGURATION
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 1,

  // REQUIRED: Test against multiple viewports
  projects: [
    // Desktop
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        screenshot: "on",
      },
    },
    // Mobile
    {
      name: "mobile-iphone",
      use: {
        ...devices["iPhone 14"],
        screenshot: "on",
      },
    },
    // Tablet
    {
      name: "tablet-ipad",
      use: {
        ...devices["iPad (gen 7)"],
        screenshot: "on",
      },
    },
  ],

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report" }],
  ],
  outputDir: "test-results",
});
```

### Why Multi-Viewport is Required
- Desktop-only testing misses mobile layout breaks (cards not stacking, text truncation)
- Mobile users hit different CORS/network issues than desktop
- Responsive design must be verified, not assumed

---

## 2. Test File Structure

Every test file must follow this structure:

```
tests/
  e2e/
    auth.spec.ts         — Login, logout, auth guard
    integration.spec.ts  — API call verification (Tier 2)
    states.spec.ts       — Loading, error, empty states
    workflows.spec.ts    — End-to-end user workflows (Tier 3)
    visual.spec.ts       — Screenshot comparison across viewports
  fixtures/
    auth.ts              — Shared login/auth helper
    api-intercept.ts     — Shared API mocking helpers
```

---

## 3. Required Test Categories

### 3.1 Auth Tests
- Login with valid credentials → dashboard loads
- Unauthenticated access → redirected to login
- Logout → auth cleared, redirected to login
- Token expiry → graceful re-auth or redirect

### 3.2 API Integration Tests (Tier 2)
For every page that fetches data:
```typescript
// CORRECT: Intercept API BEFORE navigation
const [, response] = await Promise.all([
  page.goto("/page"),
  page.waitForResponse(resp => resp.url().includes("/endpoint")),
]);
const body = await response.json();
expect(body.data.length).toBeGreaterThan(0);
```

For every button that calls an API:
```typescript
// CORRECT: Click and verify API call
const [response] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes("/endpoint")),
  page.getByRole("button", { name: "Action" }).click(),
]);
expect(response.status()).toBe(200);
```

### 3.3 State Tests
For every data-fetching page, mock the API to verify:
- **Error state**: `route.fulfill({ status: 500 })` → error message visible
- **Empty state**: `route.fulfill({ body: JSON.stringify({ data: [] }) })` → empty message visible
- **Loading state**: `await new Promise(r => setTimeout(r, 3000)); route.continue()` → skeleton visible

### 3.4 Cross-Origin API Tests
When frontend calls multiple backend services (different origins):
- Use `page.route()` to intercept and verify the request was made
- OR verify the UI updates after the cross-origin call completes
- NEVER assume cross-origin calls work just because same-origin calls do

### 3.5 Visual Regression Tests
```typescript
// Capture baseline screenshots across all viewports
test("visual: dashboard", async ({ page }) => {
  await login(page);
  await page.waitForTimeout(3000); // Wait for all data to load
  await expect(page).toHaveScreenshot("dashboard.png", {
    maxDiffPixelRatio: 0.05,
    fullPage: true,
  });
});
```

### 3.6 Mobile-Specific Tests
Every test that runs on desktop MUST also pass on mobile viewport.
Common mobile failures to test for:
- Navigation menu accessible (hamburger/slide-out)
- Cards stack vertically (not overflow horizontally)
- Buttons are tappable (min 44x44px touch target)
- Text is readable (no truncation that hides meaning)
- Modals/dialogs fit within viewport

---

## 4. What Tests Must NOT Do

- **Never** check only `toContainText()` and call it an integration test
- **Never** test only at desktop viewport
- **Never** skip cross-origin API verification
- **Never** assume a placeholder/animated element is functional without clicking it
- **Never** count test quantity as a quality metric

---

## 5. Test Reporting Format

```
TESTS: [total]
  Desktop: [pass]/[total]
  Mobile: [pass]/[total]
  Tablet: [pass]/[total]

TIER BREAKDOWN:
  Tier 1 (render): [count] — should be 0 for integration suites
  Tier 2 (integration): [count]
  Tier 3 (workflow): [count]

COVERAGE:
  API endpoints verified: [X]/[Y]
  Buttons/CTAs clicked: [X]/[Y]
  Forms submitted: [X]/[Y]
  Error states: [X]/[Y] pages
  Empty states: [X]/[Y] pages
  Loading states: [X]/[Y] pages
  Cross-origin calls: [X]/[Y]
  Mobile responsive: [X]/[Y] pages

VISUAL REGRESSION:
  Screenshots captured: [count]
  Viewports: desktop, mobile, tablet
  Diff threshold: 5%
```

---

## 6. Functional Feature Tests

### Every UI control must be tested for BEHAVIOR, not just presence:

**Switches/Toggles:**
```typescript
// BAD: Only checks if switch exists
await expect(page.locator("button[role='switch']")).toBeVisible();

// GOOD: Toggles and verifies the state changed + API called
const toggle = page.locator("button[role='switch']").first();
const wasChecked = await toggle.getAttribute("aria-checked");
await toggle.click();
const [response] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes("/toggle")),
  toggle.click(),
]);
expect(response.status()).toBe(200);
```

**Notification Bell/Badge:**
- If it has an animated indicator, clicking it MUST show real content
- If no real notification system exists, remove the animation/badge
- A pulsing dot that leads to nothing is theater code (Rule 3 violation)

**Feature Flags:**
- Toggle off → verify the feature is actually hidden/disabled in the UI
- Toggle on → verify the feature appears/enables
- Verify flags persist across page refresh

---

## 7. Anti-Theater Checklist for UI Elements

Before shipping any UI element, answer these questions:
1. Does this element DO something when interacted with? → If no, remove it
2. Does this element show REAL data? → If no, label as placeholder or remove
3. Does this element persist its state? → If no, it's cosmetic
4. Would a user be confused/frustrated by this element? → If yes, fix or remove

Examples of theater UI that must be caught:
- Notification bell with animated dot but empty dropdown
- Feature flag switches that don't control anything
- "Save" buttons that show success toast but don't persist
- Search bars that don't filter anything
- Progress indicators that don't reflect real progress

---

## 8. TDD Modification Hook (Agent Guard)

To prevent test-criteria tampering during TDD, agent workflows must enforce a
strict test-file modification hook:

- **Pre-tool path monitoring:** Before file-modifying operations, evaluate the
  target path and block if it is under test directories or test-named files.
- **Blocking exit code:** Violations must return exit code `2` (hard block).
- **Required error message:** Use explicit wording equivalent to
  `"modifications to test folders are not allowed"`.
- **Auto-correction behavior:** On block, the agent must read failure logs and
  fix application code instead of mutating tests.

Reference implementation in this repo:
- `scripts/tdd-modification-hook.sh`
