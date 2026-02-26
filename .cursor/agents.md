# Agents Operating Rules — All Repositories

## Purpose

These rules exist because of repeated failures: false completion claims, theater code, incomplete implementations declared as "done", and plans executed at 10% then marked 100%. These rules are non-negotiable.

---

## Workflow orchestration (execution model)

These rules describe how to run work. They do not loosen any evidence gate below.

- Plan mode default: Enter plan mode for any non-trivial task (3+ steps or architectural decisions).
- Stop and re-plan: If verification fails or scope changes, stop immediately and re-plan; do not keep pushing.
- Subagent strategy: Use subagents liberally for research/exploration and parallel analysis; keep one tack per subagent.
- Verification before done: Never claim completion without pasted evidence (command output, curl response body, screenshots).
- Demand elegance (balanced): For non-trivial changes, pause and ask if there is a simpler/more elegant design; skip for obvious fixes.
- Autonomous bug fixing: For bug reports, reproduce via logs/errors/failing tests, fix app code, and prove correctness with evidence.

## Task management (repo docs)

- Plan first: Write a checkable plan to `tasks/todo.md` (acceptance criteria + verification per item).
- Track progress: Mark items complete as you go; keep only one task in progress at a time (Rule 0a still applies).
- Document results: Add a short review/results section to `tasks/todo.md` (what changed, how verified, commands run).
- Capture lessons: After any correction from the user, update `tasks/lessons.md` with the pattern and a repeat-prevention rule.

## Part 0: Hard Gates (v5 — added after repeated non-compliance)

These gates override everything. They cannot be skipped, deferred, or rationalized away.
They exist because rules, mechanisms, and checklists were all ignored when the agent
optimized for speed. These gates make speed-optimization physically impossible.

---

## Rule 0: Mandatory Gate — No Code Without Checklist

**BEFORE writing ANY code or making ANY file change, you MUST:**

1. State the **task name** and **acceptance criteria** in the conversation
2. List **every file** you will modify
3. State the **verification command** you will run AFTER

**AFTER every file change, BEFORE moving to the next task:**

1. Run the verification command (test, curl with response body, screenshot)
2. Paste the **Pre-Flight Checklist** (Mechanism 1) with **actual evidence** in the conversation
3. If ANY checkbox is NO or FAIL → **STOP. Fix it. Do not continue.**

### VIOLATION CONSEQUENCE

If you claim "done", "complete", "all green", "deployed", or any synonym
WITHOUT a filled Pre-Flight Checklist containing **pasted command output**
as evidence in the conversation, the **ENTIRE session's work is considered
INVALID** and must be re-done from scratch with proper verification.

"I verified it" without pasted output = violation.
"All endpoints return 200" without pasted curl output = violation.
"Tests pass" without pasted test output = violation.

---

## Rule 0a: Sequential Gate — Evidence Before Next Task

You may NOT have more than **ONE task in progress** at a time.
You may NOT start task N+1 until task N has:

1. A completed **Pre-Flight Checklist** with **PASS verdict**
2. **Pasted evidence** (curl output, test output, or screenshot)

**Autonomous mode IS allowed. Continuous execution IS allowed.**
What is NOT allowed is skipping verification to "come back later."

If at any point you realize you skipped verification on a previous
task, you MUST go back and verify it BEFORE continuing forward.
No "I'll fix it at the end" — that's how 6 unverified batches happen.

### Why This Exists

The problem was never autonomous execution — it was skipping verification
to move faster. This gate makes verification the physical prerequisite
for forward progress, not a checkbox to fill in later.

---

## Rule 0b: Playwright Screenshot Gate — Required for ANY UI Change

Any task that modifies a `.tsx` file MUST include:

1. Playwright screenshot of the affected page(s) on **desktop** (1440x900)
2. Playwright screenshot of the affected page(s) on **mobile** (390x844)
3. Screenshots must be **captured and viewable** (saved to test-results/)

If Playwright cannot run (e.g., browser not installed), you MUST:

1. State explicitly: "I could not capture screenshots because [reason]"
2. Mark the task as **NOT VERIFIED** in the Pre-Flight Checklist
3. Do NOT claim the task is done

"I wrote the code and it compiles" is NOT done for UI tasks.

---

## Rule 0c: Anti-Rationalization Clause

You are NOT allowed to rationalize skipping any Rule 0 gate with:

- "This is a small change, it doesn't need verification"
- "I'll verify everything at the end"
- "The user said to proceed quickly"
- "I'll come back and test later"
- "The curl status code proves it works"
- "TypeScript compiles so it's correct"

There are **ZERO exceptions** to Rule 0. Not for time pressure, not for
small changes, not for "obvious" fixes. Every task gets a Pre-Flight
Checklist. Every UI change gets screenshots. Every 3 tasks gets a
hard stop for user check-in.

---

## Part 1: Rules

## Rule 1: No False Completion Claims

**NEVER say "done", "complete", "all green", or "deployed" unless you have VERIFIED evidence.**

Evidence requirements by type:

- **Backend endpoint**: HTTP response with status code AND response body shown in output
- **Frontend page/component**: Playwright test passing OR screenshot proving it works
- **Security control**: `curl -I` header dump showing the header exists on the LIVE service
- **Infrastructure resource**: `gcloud` or `terraform` output proving the resource exists and is healthy
- **Database table/view**: `bq query` output showing the table exists and has expected schema

If you cannot produce evidence, say: *"I wrote the code but have not verified it works."*

---

## Rule 2: Definition of Done (DoD)

A task is NOT done until ALL of the following are true:

1. **Code written** — the actual implementation, not a placeholder/stub
2. **Code compiles** — `npm run build` or `python -m py_compile` passes
3. **Code deployed** — pushed to Cloud Run/GCP and confirmed running
4. **Code verified** — tested with real request/interaction, evidence captured
5. **No theater** — every button, switch, form, and CTA performs a real operation

**You MUST fill out the Pre-Flight Checklist (Part 2) before claiming a task is done.**

---

## Rule 3: No Theater Code

**Theater code** = code that looks functional but does nothing real.

Examples:
- `toast.info("Feature coming soon")` — placeholder masquerading as functionality
- Mock data arrays presented as "live data"
- `setTimeout(() => setResponse(fakeData), 1200)` — simulated API responses
- Functions that exist but are never called
- Pydantic models defined but not wired to endpoints
- `generateResponse()` returning hardcoded strings instead of calling an API

**The test:** If you deleted the code, would the user notice? If not, it's theater.

**When you MUST use a placeholder** (e.g., external API not available), explicitly label it:
```
// PLACEHOLDER: Replace with real Vertex AI call when API key is configured
```

---

## Rule 4: Plan Breakdown Requirements

Before executing any plan with more than 3 tasks:

### 4.1 Task Decomposition
Every task must be broken down to **≤2 hours of work**.

### 4.2 Each Task Must Have:
- **Acceptance criteria** — what specifically proves this is done
- **Verification command** — the exact command/test that proves it
- **Files touched** — list every file that will be modified
- **Dependencies** — what must be done first

### 4.3 Estimation Honesty
If a plan estimates 27 hours, it takes 27 hours. You cannot do 27 hours of work in 2 hours. If time is constrained:
- Explicitly say: *"This plan has 12 items. I can complete items 1-3 in this session."*
- Do NOT start all 12 and finish none
- Complete items sequentially, fully, before starting the next

---

## Rule 5: Verification Before Proceeding

After completing each task (not each phase — each TASK):

1. **Run the verification** specified in the acceptance criteria
2. **Show the output** in the conversation
3. **Run Playwright tests** if the task affects any UI
4. **Gap check** — ask yourself: "If the user clicked every button on this page right now, would anything fail silently or show a placeholder?" If yes, THE TASK IS NOT DONE.

---

## Rule 6: No Bulk Sed Edits on Business Logic

**Never use `sed` to modify business logic across multiple files.**

`sed` is acceptable for: fixing typos, updating version numbers, replacing import paths.

`sed` is NOT acceptable for: replacing function parameters, modifying endpoint logic, changing error handling patterns.

**Why:** Sed doesn't understand code context. It creates syntax errors, breaks logic, and produces code you haven't actually read.

---

## Rule 7: Deploy and Verify Every Service Change

When changing backend service code:

1. **Syntax check** — `python3 -m py_compile main.py`
2. **Build** — Cloud Build or Docker build
3. **Deploy** — `gcloud run deploy`
4. **Health check** — `curl /health` returns 200
5. **Feature check** — call the changed endpoint, verify response body

If any step fails, FIX BEFORE MOVING ON.

---

## Rule 8: Honest Status Reporting

When reporting status, use this exact format:

```
ITEM: [description]
  - Code written: YES/NO
  - Compiled/built: YES/NO
  - Deployed: YES/NO (service name + revision)
  - Verified: YES/NO (paste evidence)
  - STATUS: DONE / IN PROGRESS / NOT STARTED / BLOCKED
```

**Never summarize as "✅ All done" unless every sub-item is individually verified.**

---

## Rule 9: Error Handling is Not Optional

Every `try/except` block must:
1. Catch a SPECIFIC exception type (not bare `Exception` unless it's a top-level safety net with logging)
2. Log the full error server-side (`logger.exception()`)
3. Return a structured error to the client (`{"error": "message", "code": "CODE"}`)
4. Never expose internal stack traces, file paths, or SQL queries to the client

---

## Rule 10: Frontend-Backend Contract

Every frontend component that displays data or handles user actions must have:

1. **A real API call** — via React Query hook calling a real endpoint
2. **Loading state** — `<Skeleton>` or spinner while fetching
3. **Error state** — error message when API fails
4. **Empty state** — meaningful message when data is empty (not a blank page)
5. **No fallback arrays** — if the API returns empty, show empty

Every button/switch/form must either:
- Call a real API endpoint and handle success/error
- Navigate to a real route
- Open a real external resource

---

## Rule 11: Git Commit Honesty

Commit messages must accurately describe what was DONE, not what was INTENDED.

❌ Bad: `"Add CORS, rate limiting, security headers to all services"`
✅ Good: `"Add CORS to api-backend (deployed+verified). Other 4 services not yet rebuilt."`

---

## Rule 13: Commit Cadence + Lookback

### Commit Frequency
- Commit and push **after every verified task** (not after every batch/phase)
- Never accumulate more than **3 verified tasks** without committing
- Never go more than **30 minutes of active work** without a commit

### Lookback at Every Commit
Before every `git commit`, perform a **lookback scan**:

1. **Check the Pre-Flight trail**: For every task since the last commit,
   is there a Pre-Flight Checklist with PASS in the conversation? If not,
   that task is NOT done — go back and verify before committing.

2. **Check for skipped work**: Review the plan. Are there tasks you
   started but didn't finish? Items you said you'd "come back to"?
   List them explicitly in the commit message as `NOT DONE:`.

3. **Traceability matrix update**: Every 10 tasks (or at natural phase
   boundaries like deploys), produce a **Traceability Matrix** (Mechanism 3)
   summarizing all completed tasks with their evidence references.
   Include this as a comment in the commit or in the scratchpad.

### Commit Message Must Include
```
VERIFIED TASKS in this commit:
  - [task]: [evidence type] (Pre-Flight: PASS)

NOT DONE (if any):
  - [task]: [reason]

LOOKBACK: [X] tasks since last commit, [X] Pre-Flights completed
```

### Why This Exists
Regular commits with lookback create an audit trail that makes
skipped verification visible. If the lookback finds gaps, the
commit is blocked until those gaps are filled.

---

## Rule 12: Research-Backed Plans Require Research-Backed Execution

If a plan references "best practices", the implementation must actually follow them. Citing a recommendation in a plan and then not implementing it creates a false sense of security.

---

# PART 2: ENFORCEMENT MECHANISMS

These mechanisms exist because rules alone don't prevent violations. They FORCE compliance by requiring specific outputs before work can be considered done.

---

## Mechanism 1: Pre-Flight Checklist (Required Per Task)

Before marking ANY task as done, fill out this template IN the conversation:

```
PRE-FLIGHT: [Task Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files modified:
  - [file1.py] — [what changed]
  - [file2.tsx] — [what changed]

Syntax/Build:
  □ python -m py_compile / npm run build → [PASS/FAIL]

Deployed:
  □ Service: [name] Revision: [id] → [PASS/FAIL]

Verification evidence:
  □ [paste actual command + output, not a description]

Theater check:
  □ Read every modified function — any dead code? [YES/NO]
  □ Every button/CTA does something real? [YES/NO]

Error handling:
  □ Every try/except catches specific type? [YES/NO]
  □ Client never sees raw tracebacks? [YES/NO]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT: [DONE / NOT DONE — reason]
```

**If any checkbox is NO or FAIL, the task is NOT DONE. Fix it first.**

---

## Mechanism 2: File Audit Protocol

When auditing a file for compliance, you must OPEN AND READ IT — not grep it. Grepping for keywords is not an audit.

**Anti-Shortcut Rule:** If you audit more than 15 files per hour, you're not reading them. Slow down.

### For Python backend files (.py):
1. Does every endpoint have input validation (Pydantic or explicit checks)?
2. Does every try/except catch a specific exception type?
3. Does every error response use structured JSON (not raw string)?
4. Are there any functions defined but never called?
5. Are there any hardcoded secrets, IPs, or project IDs that should be env vars?
6. Does the file import and apply the shared security middleware?

### For Frontend page files (.tsx):
1. Does this page fetch data from a real API hook (useRevenue, usePipeline, etc.)?
2. Does it render `<Skeleton>` components while data is loading?
3. Does it render an error message when the API call fails?
4. Does it render a meaningful empty state when data array is empty?
5. Does every `<Button onClick={...}>` call a real function (not toast.info)?
6. Does every `<Switch onCheckedChange={...}>` call a real API mutation?
7. Are there any hardcoded data arrays used for display?
8. Are expensive computations wrapped in `useMemo`?
9. Are event handlers wrapped in `useCallback` when passed to child components?

### For Terraform files (.tf):
1. Are all values parameterized via variables (no hardcoded project IDs)?
2. Do all resources have appropriate labels?
3. Are there any commented-out resources that should be deleted?
4. Do outputs expose all values needed by dependent modules?

### For SQL files (.sql):
1. Are all project/dataset references using `${PROJECT_ID}` and `${TENANT_ID}` templates?
2. Are there any hardcoded IDs or credentials?
3. Are partition and clustering keys appropriate for query patterns?

### For Test files (.py/.ts):
1. Does the test actually assert something meaningful (not just "it doesn't crash")?
2. Does the test use real API calls or properly mocked ones?
3. Are there any skipped tests that should be enabled?

---

## Mechanism 3: Traceability Matrix

For any multi-task plan, maintain a traceability matrix:

```
| Plan Item | Code Files | Test/Verification | Evidence | Status |
|-----------|-----------|-------------------|----------|--------|
| CORS | security.py | curl -I output | [link] | DONE |
| Rate limit | security.py | 11th request → 429 | [link] | BLOCKED |
```

**Every cell must be filled. Empty cells = not done.**

---

## Mechanism 4: Compliance Audit Protocol

When performing a repo-wide compliance audit:

1. **Read each file** — open it, read it, understand what it does
2. **Answer the audit questions** from Mechanism 2 for that file type
3. **Record findings** — list specific violations with line numbers
4. **Remediate** — fix each violation, then re-verify
5. **Commit per batch** — include findings and remediations in commit message

**Speed limit:** Max 15 files per hour for meaningful audit. A 200-file repo takes ~14 hours minimum.

---

## Mechanism 5: Definition of "Verified"

The word "verified" means ONE of these, depending on the type:

| Type | Verification Method |
|------|-------------------|
| Backend endpoint | `curl` with response body shown |
| Frontend page | Playwright test passing with screenshot |
| Security header | `curl -I` with header value shown |
| Database resource | `bq query` or `gcloud` output shown |
| Infrastructure | `terraform show` or `gcloud describe` output |
| Rate limiting | Demonstrate the Nth+1 request returns 429 |
| Error handling | Send malformed input, show structured error response |
| Loading state | Screenshot showing skeleton during fetch |
| Empty state | Screenshot showing empty message when no data |

**"I looked at it and it seems fine" is NOT verification.**

---

## Mechanism 6: Test Quality Standard

**A test that only checks if text is visible is a RENDER test, not an integration test.**

Tests are categorized into three tiers. When asked to "test frontend integration," you must write Tier 2 or Tier 3 tests, not Tier 1.

### Tier 1: Render Test (insufficient for integration verification)
Checks that a page loads and static text/elements are visible.
```typescript
// BAD — this only proves JSX rendered, not that the API was called
await expect(page.locator("main")).toContainText("Pipeline Value");
```

### Tier 2: Integration Test (minimum for "does it work")
Performs a user action, waits for the backend response, and verifies the UI updated with real data.
```typescript
// GOOD — clicks a button and verifies the API response affected the UI
await page.getByRole("button", { name: "Run All Plugins" }).click();
await page.waitForResponse(resp => resp.url().includes("/dispatch") && resp.status() === 200);
await expect(page.locator("[data-testid=toast]")).toContainText("dispatched");
```

### Tier 3: End-to-End Workflow Test (gold standard)
Completes a full user workflow across multiple pages/APIs.
```typescript
// BEST — creates a lead, verifies it appears in the customer list
await page.goto("/crm");
await page.getByRole("button", { name: "Add Lead" }).click();
await page.fill('[name=email]', 'test@newcorp.com');
await page.fill('[name=first_name]', 'Test');
await page.getByRole("button", { name: "Create Lead" }).click();
await page.waitForResponse(resp => resp.url().includes("/leads") && resp.status() === 200);
await expect(page.locator("[data-testid=toast]")).toContainText("created");
```

**Anti-Shallow-Test Rule:** If a test name contains "from API", "integration", "backend", or "works", the test MUST include at least one of:
- `waitForResponse()` — verifying an API call was made
- `click()` → assertion — verifying a user action produced a result
- Response body check — verifying the API returned expected data

A test that only uses `toContainText()` or `toBeVisible()` on static content is NOT an integration test regardless of its name.

---

## Mechanism 7: Integration Test Coverage Requirements

When asked to test frontend-to-backend integration, the test suite MUST include:

### For every page that fetches data:
- [ ] Verify the API call is made (intercept or waitForResponse)
- [ ] Verify the response data appears in the UI (not just static text)
- [ ] Verify loading skeleton shows before data loads (throttle network)
- [ ] Verify error message shows when API fails (mock 500 response)

### For every button that calls an API:
- [ ] Click the button
- [ ] Verify the API call is made with correct method and URL
- [ ] Verify success feedback (toast, UI update, navigation)
- [ ] Verify error feedback when API fails

### For every form that submits data:
- [ ] Fill all fields with valid data
- [ ] Submit the form
- [ ] Verify the API call includes the form data
- [ ] Verify success feedback
- [ ] Test with invalid data and verify validation messages

### For every toggle/switch:
- [ ] Toggle on → verify API call with is_active=true
- [ ] Toggle off → verify API call with is_active=false
- [ ] Verify optimistic update (UI changes immediately)
- [ ] Verify revert on API failure

### For visual consistency:
- [ ] Capture screenshot of every page in dark mode
- [ ] Capture screenshot of every page in light mode
- [ ] Compare: consistent spacing, colors, typography across pages

**Test count is NOT a quality metric.** 5 Tier 2 tests are worth more than 50 Tier 1 tests.

---

## Mechanism 8: Anti-Volume-Optimization Rule

**Never optimize for test count.** The goal is coverage and depth, not numbers.

When reporting test results, use this format:
```
TESTS: 12 total
  - Tier 1 (render): 3
  - Tier 2 (integration): 7
  - Tier 3 (e2e workflow): 2

COVERAGE:
  - API calls verified: 9/12 endpoints
  - Buttons clicked: 7/10
  - Forms submitted: 2/3
  - Error states tested: 4/11 pages
  - Loading states tested: 0/11 pages (GAP)
```

**"35 passed" without tier classification and coverage metrics is not an acceptable report.**

---

## Mechanism 9: Reusable Testing Standard (Required)

All E2E testing MUST follow the testing standard defined in `.cursor/testing-standard.md`.

Key requirements enforced by this standard:

1. **Multi-viewport testing is mandatory** — every test runs on desktop (1440x900), mobile (iPhone 14), and tablet (iPad). Desktop-only testing is NOT acceptable.

2. **Cross-origin API calls must be tested** — if the frontend calls multiple backend services at different origins, each must be verified.

3. **Every interactive UI element must be tested for BEHAVIOR** — not just presence. A switch that exists but doesn't toggle anything is a test failure.

4. **Anti-theater checklist** — before shipping any UI element: Does it DO something? Does it show REAL data? Does it PERSIST? Would a user be frustrated by it?

5. **Playwright config must use `projects` array** with at least 3 device profiles (desktop, mobile, tablet).

6. **Visual regression** via `toHaveScreenshot()` with 5% diff threshold across all viewports.

See `.cursor/testing-standard.md` for complete configuration, test structure, and reporting format.

---

## Mechanism 10: TDD Modification Hook (Hard Block)

Agents must not modify test files when executing TDD fixes unless explicitly
authorized. This is enforced as a hard gate:

1. **Pre-tool path check** before file modifications.
2. **Block test paths/names** (`tests/`, `*/tests/*`, `*.test.*`, `*.spec.*`,
   `test_*`, `*_test.py`, and filenames containing `test`).
3. **Exit code 2** on violation.
4. **Explicit message** indicating test-folder modifications are not allowed.
5. **Recovery behavior**: read failing test logs and fix application code.

Repository command references:
- Pre-commit: `bash scripts/tdd-modification-hook.sh --staged`
- CI: `bash scripts/tdd-modification-hook.sh --range <base...HEAD>`
