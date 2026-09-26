import type { Issue, SeverityCounts } from '@/types';

export const mockIssues: Issue[] = [
  {
    id: 'issue-1',
    title: 'Refund handler has a cyclomatic complexity of 24',
    description:
      'processRefund() branches across partial refunds, currency conversion, loyalty points, and fraud holds inside a single function, making it difficult to test or safely modify.',
    category: 'complexity',
    severity: 'critical',
    filePath: 'src/services/payments/checkoutService.ts',
    lineStart: 118,
    lineEnd: 214,
    status: 'open',
    detectedAt: '2026-08-29T09:12:00Z',
    metrics: [
      { label: 'Cyclomatic complexity', value: 24 },
      { label: 'Function length', value: 96, unit: 'lines' },
      { label: 'Test coverage', value: 12, unit: '%' },
    ],
    aiExplanation:
      'The function handles four distinct refund scenarios through nested conditionals rather than separate code paths. Each new payment method or promotion type increases branching, which is why coverage has stayed low despite repeated bug fixes here.',
    aiRecommendation:
      'Extract each refund scenario (standard, partial, loyalty-adjusted, fraud-held) into its own strategy function behind a shared interface, then add contract tests per strategy before touching shared logic again.',
    affectedComponents: ['CheckoutService', 'RefundQueueWorker', 'OrdersAPI'],
    codeSnippet: `function processRefund(order, request) {
  if (request.type === 'partial') {
    if (order.currency !== request.currency) {
      // inline conversion + rounding logic
    }
    if (order.loyaltyPointsUsed > 0) {
      // recompute point balance
    }
  } else if (request.fraudHold) {
    // manual review branch
  } else {
    // standard refund
  }
}`,
  },
  {
    id: 'issue-2',
    title: 'Duplicate order-status mapping across three files',
    description:
      'The same order status → label mapping is copy-pasted in OrderTable.tsx, OrderDetail.tsx, and the admin dashboard, so status labels have already drifted out of sync.',
    category: 'duplication',
    severity: 'medium',
    filePath: 'src/components/legacy/OrderTable.tsx',
    lineStart: 34,
    lineEnd: 58,
    status: 'open',
    detectedAt: '2026-08-29T09:12:00Z',
    metrics: [
      { label: 'Duplicated blocks', value: 3 },
      { label: 'Duplicated lines', value: 72 },
    ],
    aiExplanation:
      'All three copies map the same seven order statuses to display labels and colors, but one copy is missing the "partially_refunded" case, which is why that status currently renders blank in the admin view.',
    aiRecommendation:
      'Move the mapping into a single `orderStatus.ts` constant exporting label and color lookups, then replace all three call sites with imports.',
    affectedComponents: ['OrderTable', 'OrderDetail', 'AdminDashboard'],
  },
  {
    id: 'issue-3',
    title: 'Circular dependency between inventory and pricing',
    description:
      'inventory/stockService.ts imports pricing/priceEngine.ts, which imports back into inventory/index.ts, creating a module cycle that blocks safe incremental builds.',
    category: 'architecture',
    severity: 'high',
    filePath: 'src/modules/inventory/stockService.ts',
    lineStart: 1,
    lineEnd: 12,
    status: 'open',
    detectedAt: '2026-08-27T14:40:00Z',
    metrics: [
      { label: 'Cycle length', value: 3, unit: 'modules' },
      { label: 'Affected files', value: 11 },
    ],
    aiExplanation:
      'Pricing needs live stock counts for dynamic pricing rules, and inventory needs price bands to flag low-margin restocks. Neither dependency is essential at import time, only at call time.',
    aiRecommendation:
      'Introduce a shared `StockPriceSnapshot` type passed as a function argument instead of a cross-module import, breaking the cycle without losing functionality.',
    affectedComponents: ['StockService', 'PriceEngine', 'InventoryModule'],
  },
  {
    id: 'issue-4',
    title: 'Hardcoded fallback JWT secret in tokenManager',
    description:
      'A hardcoded string is used as a fallback signing secret when the environment variable is unset, which would silently sign tokens with a known value in misconfigured environments.',
    category: 'security',
    severity: 'critical',
    filePath: 'src/lib/auth/tokenManager.ts',
    lineStart: 9,
    lineEnd: 9,
    status: 'acknowledged',
    detectedAt: '2026-08-25T11:02:00Z',
    metrics: [
      { label: 'CWE', value: 'CWE-798' },
      { label: 'Exposure', value: 'High' },
    ],
    aiExplanation:
      'If AUTH_SECRET is undefined at boot, the app falls back to a literal string committed to the repository rather than failing to start. Any environment with a missing variable would issue forgeable tokens.',
    aiRecommendation:
      'Throw on startup if AUTH_SECRET is missing rather than falling back to a default, and rotate the current secret since it has been present in version history.',
    affectedComponents: ['TokenManager', 'AuthMiddleware', 'SessionService'],
    codeSnippet: `const SECRET = process.env.AUTH_SECRET || 'orbit-dev-secret-2023';`,
  },
  {
    id: 'issue-5',
    title: 'Unbounded utility file mixing unrelated responsibilities',
    description:
      'formatters.ts has grown to 41 exported functions covering currency, dates, phone numbers, and slugs, none of which are unit tested.',
    category: 'code-smell',
    severity: 'medium',
    filePath: 'src/utils/formatters.ts',
    lineStart: 1,
    lineEnd: 340,
    status: 'open',
    detectedAt: '2026-08-24T08:15:00Z',
    metrics: [
      { label: 'Exported functions', value: 41 },
      { label: 'Test coverage', value: 0, unit: '%' },
    ],
    aiExplanation:
      'A single catch-all utility file tends to accumulate unrelated helpers over time because it is the path of least resistance for new contributors. It also has no clear owner, which is likely why coverage is at zero.',
    aiRecommendation:
      'Split into currency.ts, dates.ts, strings.ts, and validation.ts, each with focused unit tests, and re-export from a barrel file to avoid breaking existing imports immediately.',
    affectedComponents: ['Formatters', 'OrderTable', 'InvoicePDF', 'CustomerProfile'],
  },
  {
    id: 'issue-6',
    title: 'Unvalidated redirect in OAuth callback route',
    description:
      'The `returnTo` query parameter is used directly in a redirect without validating it against an allow-list of internal paths.',
    category: 'security',
    severity: 'high',
    filePath: 'src/routes/auth/callback.ts',
    lineStart: 22,
    lineEnd: 27,
    status: 'open',
    detectedAt: '2026-08-22T16:30:00Z',
    metrics: [
      { label: 'CWE', value: 'CWE-601' },
      { label: 'Exposure', value: 'Medium' },
    ],
    aiExplanation:
      'An attacker can craft a login link with an external `returnTo` value, and a signed-in user would be redirected off-platform immediately after authenticating, a classic open-redirect phishing setup.',
    aiRecommendation:
      'Restrict `returnTo` to same-origin relative paths using a strict allow-list check before calling redirect().',
    affectedComponents: ['AuthCallbackRoute', 'SessionService'],
  },
  {
    id: 'issue-7',
    title: 'Deeply nested promotion rules engine',
    description:
      'applyPromotions() has five levels of nested conditionals evaluating stacked discount rules, making the eligible-discount order hard to reason about.',
    category: 'complexity',
    severity: 'high',
    filePath: 'src/services/pricing/promotionEngine.ts',
    lineStart: 40,
    lineEnd: 132,
    status: 'open',
    detectedAt: '2026-08-21T10:05:00Z',
    metrics: [
      { label: 'Max nesting depth', value: 5 },
      { label: 'Cyclomatic complexity', value: 19 },
    ],
    aiExplanation:
      'Discount stacking rules were added incrementally as nested if-blocks rather than as an ordered rule list, so the effective priority of promotions is implicit in code order rather than explicit.',
    aiRecommendation:
      'Model promotions as an ordered list of rule objects evaluated by a single reducer, making priority explicit and testable in isolation.',
    affectedComponents: ['PromotionEngine', 'CheckoutService', 'CartSummary'],
  },
  {
    id: 'issue-8',
    title: 'Duplicated API error-handling block',
    description:
      'The same try/catch/toast pattern is repeated across 9 API hook files instead of being centralized.',
    category: 'duplication',
    severity: 'low',
    filePath: 'src/hooks/useOrders.ts',
    lineStart: 14,
    lineEnd: 29,
    status: 'open',
    detectedAt: '2026-08-19T09:44:00Z',
    metrics: [
      { label: 'Duplicated blocks', value: 9 },
      { label: 'Duplicated lines', value: 126 },
    ],
    aiExplanation:
      'Each data-fetching hook re-implements the same error normalization and toast notification, so a fix to one (like the recent 401 handling patch) has to be manually copied to the other eight.',
    aiRecommendation:
      'Extract a shared `useApiRequest` hook wrapping fetch with consistent error handling, and migrate call sites incrementally.',
    affectedComponents: ['useOrders', 'useInventory', 'useCustomers'],
  },
  {
    id: 'issue-9',
    title: 'Refund tests missing for currency conversion path',
    description:
      'None of the existing test suites exercise the cross-currency branch inside processRefund(), which handled a production incident in July.',
    category: 'complexity',
    severity: 'high',
    filePath: 'src/services/payments/checkoutService.ts',
    lineStart: 140,
    lineEnd: 168,
    status: 'open',
    detectedAt: '2026-08-29T09:12:00Z',
    metrics: [
      { label: 'Test coverage (branch)', value: 0, unit: '%' },
      { label: 'Related incidents', value: 1 },
    ],
    aiExplanation:
      'The cross-currency refund branch was added as a hotfix during the July incident and never received dedicated tests, leaving the exact code path that previously failed unverified.',
    aiRecommendation:
      'Add table-driven tests covering at least three currency pairs and rounding edge cases before the next release touches this file.',
    affectedComponents: ['CheckoutService', 'RefundQueueWorker'],
  },
  {
    id: 'issue-10',
    title: 'God component: OrderTable renders, fetches, and paginates',
    description:
      'OrderTable.tsx owns data fetching, client-side filtering, sorting, pagination, and rendering in one 480-line component.',
    category: 'code-smell',
    severity: 'medium',
    filePath: 'src/components/legacy/OrderTable.tsx',
    lineStart: 1,
    lineEnd: 480,
    status: 'open',
    detectedAt: '2026-08-18T13:20:00Z',
    metrics: [
      { label: 'Component length', value: 480, unit: 'lines' },
      { label: 'Responsibilities', value: 5 },
    ],
    aiExplanation:
      'Data-fetching and presentation concerns are interleaved, which is likely why the duplicated status-mapping issue (issue-2) exists — there is no shared boundary to put the mapping behind.',
    aiRecommendation:
      'Split into a useOrdersTable data hook and a presentational OrderTable component, then reuse the hook wherever the admin dashboard needs the same data.',
    affectedComponents: ['OrderTable', 'AdminDashboard'],
  },
  {
    id: 'issue-11',
    title: 'Missing rate limiting on password reset endpoint',
    description:
      'POST /auth/reset-password has no throttling, allowing unlimited reset-email requests per account.',
    category: 'security',
    severity: 'medium',
    filePath: 'src/routes/auth/resetPassword.ts',
    lineStart: 8,
    lineEnd: 8,
    status: 'open',
    detectedAt: '2026-08-16T09:00:00Z',
    metrics: [
      { label: 'CWE', value: 'CWE-307' },
      { label: 'Exposure', value: 'Low' },
    ],
    aiExplanation:
      'Without throttling, the endpoint can be used to spam a user\'s inbox or probe for valid account emails via response timing.',
    aiRecommendation:
      'Apply the existing `rateLimit` middleware already used on the login route, capped at 5 requests per hour per email.',
    affectedComponents: ['AuthRoutes', 'EmailService'],
  },
  {
    id: 'issue-12',
    title: 'Pricing module exposes internal margin calculation',
    description:
      'PriceEngine.getMargin() is exported from the public module barrel and called directly by three UI components, coupling presentation to a formula that should stay internal.',
    category: 'architecture',
    severity: 'low',
    filePath: 'src/modules/pricing/index.ts',
    lineStart: 5,
    lineEnd: 5,
    status: 'open',
    detectedAt: '2026-08-14T15:10:00Z',
    metrics: [
      { label: 'Public call sites', value: 3 },
      { label: 'Coupling score', value: 'Medium' },
    ],
    aiExplanation:
      'UI components computing margin directly means any change to the margin formula requires auditing every consumer, rather than a single service boundary.',
    aiRecommendation:
      'Remove getMargin from the public barrel and expose a pre-computed `marginTier` field on the priced product instead.',
    affectedComponents: ['PriceEngine', 'ProductCard', 'AdminDashboard'],
  },
  {
    id: 'issue-13',
    title: 'Inconsistent null handling in customer address form',
    description:
      'Optional address fields are sometimes undefined and sometimes empty string, causing three separate null-check styles across the form.',
    category: 'code-smell',
    severity: 'low',
    filePath: 'src/components/checkout/AddressForm.tsx',
    lineStart: 60,
    lineEnd: 95,
    status: 'resolved',
    detectedAt: '2026-08-10T12:00:00Z',
    metrics: [
      { label: 'Inconsistent checks', value: 6 },
    ],
    aiExplanation:
      'The form accepts data from both a legacy API (which omits empty fields) and a new API (which sends empty strings), and normalization only happens partially before rendering.',
    aiRecommendation:
      'Normalize address payloads to a single shape at the API boundary so the form only ever deals with one representation of "empty".',
    affectedComponents: ['AddressForm', 'CheckoutPage'],
  },
  {
    id: 'issue-14',
    title: 'Large lodash import increases bundle size',
    description:
      'Several files import the full lodash package instead of individual functions, adding roughly 70KB gzipped to the client bundle.',
    category: 'architecture',
    severity: 'low',
    filePath: 'src/components/dashboard/AnalyticsPanel.tsx',
    lineStart: 3,
    lineEnd: 3,
    status: 'open',
    detectedAt: '2026-08-08T10:30:00Z',
    metrics: [
      { label: 'Bundle impact', value: 70, unit: 'KB gz' },
      { label: 'Affected files', value: 6 },
    ],
    aiExplanation:
      'Importing `lodash` as a whole prevents tree-shaking, whereas importing from `lodash-es` or per-function packages would let the bundler drop unused code.',
    aiRecommendation:
      'Replace `import _ from "lodash"` with targeted imports (e.g. `import groupBy from "lodash/groupBy"`) across the six affected files.',
    affectedComponents: ['AnalyticsPanel', 'InventoryReport'],
  },
];

/** Severity totals for the sample issue list. Overview and history should use this instead of separate hardcoded counts. */
export function countIssuesBySeverity(issues: Issue[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  return counts;
}
