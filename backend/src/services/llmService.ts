import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from 'openai';
import type { AiConfidence, AiInterpretation, AiObservation, EvidenceReference, EvidenceSource } from '../types/ai.js';
import type { RepositoryContext } from '../types/context.js';
import { env } from '../config/env.js';

/**
 * Interprets bounded RepoGuard context. This module does not score health,
 * rank files, or read the repository.
 *
 * The provider must return JSON that matches a strict json_schema. The parsed
 * object is checked again before it is returned. Failed provider calls are not cached.
 *
 * Output bounds: summary at most 1200 characters, at most 6 observations,
 * at most 4 evidence references each, and at most 10 limitation strings.
 *
 * Evidence items are pointers into the supplied context. A pointer that does
 * not name a present field is rejected. The factual observation is rendered
 * from those pointers. Interpretation text is labeled and is not fact-checked.
 */

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_SUMMARY = 1_200;
const MAX_OBSERVATIONS = 6;
const MAX_EVIDENCE = 4;
const MAX_LIMITATIONS = 10;
const MAX_TEXT = 500;

const EVIDENCE_SOURCES = ['ast', 'static', 'dependencies', 'history', 'repository'] as const;
const EVIDENCE_FIELDS = [
  'path',
  'fileTruncated',
  'lineCount',
  'functionCount',
  'classCount',
  'importCount',
  'exportCount',
  'maxNestingDepth',
  'functionsTruncated',
  'function',
  'totalFiles',
  'totalLines',
  'totalFunctions',
  'totalClasses',
  'totalImports',
  'totalExports',
  'parseErrors',
  'repositoryConfigUsed',
  'ruleSet',
  'findingsTruncated',
  'repositoryTruncated',
  'finding',
  'issue',
  'filesAnalyzed',
  'findingCount',
  'errorCount',
  'warningCount',
  'staticTruncated',
  'issueCountExecution',
  'issueCountParse',
  'issueCountLimit',
  'rule',
  'totalInternalNodes',
  'totalInternalEdges',
  'totalExternalPackages',
  'unresolvedImports',
  'filesWithDependencies',
  'filesWithNoDependencies',
  'maxOutgoingInternalDependencies',
  'outgoing',
  'incoming',
  'external',
  'unresolved',
  'dependenciesTruncated',
  'availableCommits',
  'uniqueAuthors',
  'totalFileChanges',
  'totalAdditions',
  'totalDeletions',
  'oldestAvailableCommitAt',
  'newestAvailableCommitAt',
  'commitsWithoutFileDiff',
  'commitCount',
  'additions',
  'deletions',
  'changeCount',
  'firstSeenAt',
  'lastChangedAt',
  'renamedFrom',
  'presentInWorkTree',
  'historyDepth',
  'isComplete',
  'name',
  'branch',
  'sourceType',
] as const;
const INDEXED_FIELDS = new Set<string>(['function', 'finding', 'issue', 'rule', 'outgoing', 'incoming', 'external', 'unresolved']);

const SYSTEM_INSTRUCTIONS = [
  'You interpret structured repository evidence produced by RepoGuard.',
  'Use only the JSON context in the user message. Do not invent files, metrics, line numbers, or source code.',
  'Do not write the factual observation. RepoGuard renders that sentence from the evidence pointers you cite.',
  'Each observation has category, confidence, evidence, and interpretation.',
  'interpretation is inference only. Do not use it to state files, counts, dependencies, history, or findings that are not established by the cited evidence.',
  'Each evidence item is an object with source, field, and index. index is null for a scalar and the list position for one item.',
  'source is ast, static, dependencies, history, or repository. field must be one of the allowed field names.',
  'Cite only a field that is present in the supplied context. If dependencies, history, or repository are absent, do not cite them and do not claim that those values are zero, empty, or absent.',
  'For a file, source ast field path is file.path and field fileTruncated is file.truncated. File AST scalars are lineCount, functionCount, classCount, importCount, exportCount, maxNestingDepth, and functionsTruncated. A function uses field function and its index.',
  'A file static finding uses source static, field finding, and its index. A file static issue uses field issue and its index. findingsTruncated, repositoryConfigUsed, and ruleSet are scalar static fields. repositoryTruncated exists only when that boolean is in the context.',
  'Repository-summary AST uses source ast and totalFiles, totalLines, totalFunctions, totalClasses, totalImports, totalExports, parseErrors, or maxNestingDepth.',
  'Repository-summary static counts use filesAnalyzed, findingCount, errorCount, warningCount, staticTruncated, issueCountExecution, issueCountParse, or issueCountLimit. A rule count uses field rule and its index.',
  'File dependency relationships use source dependencies and field outgoing, incoming, external, or unresolved with an index. dependenciesTruncated is the scalar cap flag. Summary dependency counts use totalInternalNodes, totalInternalEdges, totalExternalPackages, unresolvedImports, filesWithDependencies, filesWithNoDependencies, or maxOutgoingInternalDependencies.',
  'File Git history uses source history and commitCount, additions, deletions, changeCount, firstSeenAt, lastChangedAt, renamedFrom, presentInWorkTree, historyDepth, or isComplete. Cite these only when the history object is present.',
  'Repository-summary history uses availableCommits, uniqueAuthors, totalFileChanges, totalAdditions, totalDeletions, oldestAvailableCommitAt, newestAvailableCommitAt, historyDepth, isComplete, or commitsWithoutFileDiff.',
  'Repository identity uses source repository and field name, branch, or sourceType, only when repository is in the context.',
  'Do not produce a health score, a technical-debt score, or a ranking of files.',
  'Do not treat a metric as technical debt or as proof of a bug.',
  'Shallow or incomplete Git history is not the repository\'s full history.',
  'Parse errors mean those files were not successfully analyzed.',
  'Unresolved imports are not resolved dependencies.',
  'Static evidence is only the static object supplied in the context. Do not invent findings, rule IDs, lines, messages, or files.',
  'Do not call ESLint and do not read repository files directly.',
  'A static finding is a match against RepoGuard\'s fixed rules. It is not automatically technical debt, a health score, or proof of a bug.',
  'repositoryConfigUsed=false means the repository\'s ESLint or CI configuration was not used.',
  'Static issues are parse, execution, or limit issues, not rule findings.',
  'If static analysis is truncated or a static limitation is present, say that static coverage is incomplete. An empty finding list under incomplete coverage must not be described as clean.',
  'State important incomplete evidence in limitations.',
  'Write a short summary and at most 6 observations.',
].join(' ');

const responseFormat = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'repoguard_interpretation',
    description: 'Grounded interpretation of RepoGuard repository evidence.',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'observations', 'limitations'],
      properties: {
        summary: { type: 'string' },
        observations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['category', 'interpretation', 'evidence', 'confidence'],
            properties: {
              category: { type: 'string' },
              interpretation: { type: 'string' },
              evidence: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['source', 'field', 'index'],
                  properties: {
                    source: { type: 'string', enum: [...EVIDENCE_SOURCES] },
                    field: { type: 'string', enum: [...EVIDENCE_FIELDS] },
                    index: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
                  },
                },
              },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
          },
        },
        limitations: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

export class LlmError extends Error {
  readonly code: 'NOT_CONFIGURED' | 'TIMEOUT' | 'UNAVAILABLE' | 'RATE_LIMIT' | 'INVALID_RESPONSE';

  constructor(code: LlmError['code'], message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

interface AiConfig {
  apiKey: string;
  model: string;
}

const resultCache = new Map<string, Promise<AiInterpretation>>();

export function readAiConfig(): AiConfig {
  return { apiKey: env.openaiApiKey, model: env.openaiModel };
}

export function requireAiConfig(config: AiConfig): AiConfig {
  if (config.apiKey === '') {
    throw new LlmError('NOT_CONFIGURED', 'OPENAI_API_KEY is not configured.');
  }
  if (config.model === '') {
    throw new LlmError('NOT_CONFIGURED', 'OPENAI_MODEL is not configured.');
  }
  return config;
}

export function interpretAcquiredContext(
  cacheKey: string,
  context: RepositoryContext,
  config: AiConfig = readAiConfig(),
): Promise<AiInterpretation> {
  const configured = requireAiConfig(config);
  const key = `${cacheKey}:${configured.model}`;
  const cached = resultCache.get(key);
  if (cached) return cached;

  const pending = requestInterpretation(context, configured).catch((error: unknown) => {
    resultCache.delete(key);
    throw error;
  });
  resultCache.set(key, pending);
  return pending;
}

export async function requestInterpretation(context: RepositoryContext, config: AiConfig): Promise<AiInterpretation> {
  const configured = requireAiConfig(config);
  const client = new OpenAI({
    apiKey: configured.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  try {
    const completion = await client.chat.completions.create({
      model: configured.model,
      temperature: 0.2,
      max_completion_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTIONS },
        { role: 'user', content: JSON.stringify(context) },
      ],
      response_format: responseFormat,
    });
    const message = completion.choices[0]?.message;
    if (!message || message.refusal) {
      throw new LlmError('INVALID_RESPONSE', 'The AI provider declined to produce a structured interpretation.');
    }
    if (typeof message.content !== 'string' || message.content.trim() === '') {
      throw new LlmError('INVALID_RESPONSE', 'The AI provider returned an empty interpretation.');
    }
    return validateModelInterpretation(context, message.content);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw toLlmError(error);
  }
}

export function validateModelInterpretation(context: RepositoryContext, content: string): AiInterpretation {
  return preserveContextLimitations(context, parseInterpretation(content, context));
}

function parseInterpretation(content: string, context: RepositoryContext): AiInterpretation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw validationError('invalid_json');
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['summary', 'observations', 'limitations'])) {
    throw validationError('schema');
  }
  const summary = requireText(parsed.summary, MAX_SUMMARY);
  const observations = attachObservedFacts(context, parseObservations(parsed.observations));
  const limitations = parseLimitationStrings(parsed.limitations);
  return { summary, observations, limitations };
}

function parseObservations(value: unknown): Array<Omit<AiObservation, 'observation'>> {
  if (!Array.isArray(value)) throw validationError('schema');
  if (value.length > MAX_OBSERVATIONS) throw validationError('bounds');
  return value.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ['category', 'interpretation', 'evidence', 'confidence'])) {
      throw validationError('schema');
    }
    const category = requireText(item.category, 80);
    const interpretation = requireText(item.interpretation, MAX_TEXT);
    const evidence = parseEvidence(item.evidence);
    if (!isConfidence(item.confidence)) throw validationError('schema');
    return { category, interpretation, evidence, confidence: item.confidence };
  });
}

function attachObservedFacts(
  context: RepositoryContext,
  observations: Array<Omit<AiObservation, 'observation'>>,
): AiObservation[] {
  assertEvidenceSupported(context, observations);
  return observations.map((observation) => ({
    ...observation,
    observation: observation.evidence.map((evidence) => renderObservedFact(context, evidence)).join(' '),
  }));
}

function parseEvidence(value: unknown): EvidenceReference[] {
  if (!Array.isArray(value)) throw validationError('schema');
  if (value.length === 0 || value.length > MAX_EVIDENCE) throw validationError('bounds');
  return value.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ['source', 'field', 'index'])) throw validationError('schema');
    if (!isEvidenceSource(item.source) || !isEvidenceField(item.field)) throw validationError('schema');
    if (!(item.index === null || (typeof item.index === 'number' && Number.isInteger(item.index) && item.index >= 0))) {
      throw validationError('schema');
    }
    if (INDEXED_FIELDS.has(item.field) !== (item.index !== null)) {
      throw unsupportedReference(item.source, item.field, item.index);
    }
    return { source: item.source, field: item.field, index: item.index };
  });
}

function parseLimitationStrings(value: unknown): string[] {
  if (!Array.isArray(value)) throw validationError('schema');
  if (value.length > MAX_LIMITATIONS) throw validationError('bounds');
  return value.map((item) => requireText(item, MAX_TEXT));
}

function requireText(value: unknown, max: number): string {
  if (typeof value !== 'string') throw validationError('schema');
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '' || text.length > max) throw validationError('bounds');
  return text;
}

function assertEvidenceSupported(context: RepositoryContext, observations: Array<{ evidence: EvidenceReference[] }>): void {
  const catalog = evidenceCatalog(context);
  for (const observation of observations) {
    for (const evidence of observation.evidence) {
      const key = evidence.index === null ? `${evidence.source}\0${evidence.field}` : `${evidence.source}\0${evidence.field}\0${evidence.index}`;
      if (!catalog.has(key)) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    }
  }
}

function evidenceCatalog(context: RepositoryContext): Set<string> {
  const keys = new Set<string>();
  const add = (source: EvidenceSource, field: string, index: number | null = null) => {
    keys.add(index === null ? `${source}\0${field}` : `${source}\0${field}\0${index}`);
  };
  const addRange = (source: EvidenceSource, field: string, count: number) => {
    for (let index = 0; index < count; index += 1) add(source, field, index);
  };
  if (context.mode === 'repository-summary') {
    add('repository', 'name');
    add('repository', 'branch');
    add('repository', 'sourceType');
    for (const field of ['totalFiles', 'totalLines', 'totalFunctions', 'totalClasses', 'totalImports', 'totalExports', 'parseErrors', 'maxNestingDepth'] as const) {
      add('ast', field);
    }
    for (const field of [
      'totalInternalNodes',
      'totalInternalEdges',
      'totalExternalPackages',
      'unresolvedImports',
      'filesWithDependencies',
      'filesWithNoDependencies',
      'maxOutgoingInternalDependencies',
    ] as const) {
      add('dependencies', field);
    }
    for (const field of [
      'availableCommits',
      'uniqueAuthors',
      'totalFileChanges',
      'totalAdditions',
      'totalDeletions',
      'oldestAvailableCommitAt',
      'newestAvailableCommitAt',
      'historyDepth',
      'isComplete',
      'commitsWithoutFileDiff',
    ] as const) {
      add('history', field);
    }
    add('static', 'filesAnalyzed');
    add('static', 'findingCount');
    add('static', 'errorCount');
    add('static', 'warningCount');
    add('static', 'staticTruncated');
    add('static', 'repositoryConfigUsed');
    add('static', 'ruleSet');
    add('static', 'issueCountExecution');
    add('static', 'issueCountParse');
    add('static', 'issueCountLimit');
    addRange('static', 'rule', context.static.rules.length);
    return keys;
  }

  add('ast', 'path');
  add('ast', 'fileTruncated');
  if (context.file.ast) {
    for (const field of ['lineCount', 'functionCount', 'classCount', 'importCount', 'exportCount', 'maxNestingDepth', 'functionsTruncated'] as const) {
      add('ast', field);
    }
    addRange('ast', 'function', context.file.ast.functions.length);
  }
  add('static', 'repositoryConfigUsed');
  add('static', 'ruleSet');
  add('static', 'findingsTruncated');
  if ('repositoryTruncated' in context.file.static) add('static', 'repositoryTruncated');
  addRange('static', 'finding', context.file.static.findings.length);
  addRange('static', 'issue', context.file.static.issues.length);

  if (context.mode === 'experiment-file-baseline') return keys;

  add('repository', 'name');
  add('repository', 'branch');
  add('repository', 'sourceType');
  const dependencies = context.mode === 'file' ? context.file.dependencies : context.dependencies;
  add('dependencies', 'dependenciesTruncated');
  addRange('dependencies', 'outgoing', dependencies.outgoing.length);
  addRange('dependencies', 'incoming', dependencies.incoming.length);
  addRange('dependencies', 'external', dependencies.external.length);
  addRange('dependencies', 'unresolved', dependencies.unresolved.length);
  const history = context.mode === 'file' ? context.file.history : context.history;
  if (history) {
    for (const field of [
      'commitCount',
      'additions',
      'deletions',
      'changeCount',
      'firstSeenAt',
      'lastChangedAt',
      'renamedFrom',
      'presentInWorkTree',
      'historyDepth',
      'isComplete',
    ] as const) {
      add('history', field);
    }
  }
  return keys;
}

function renderObservedFact(context: RepositoryContext, evidence: EvidenceReference): string {
  const pointer = `${evidence.source}.${evidence.field}${evidence.index === null ? '' : `[${evidence.index}]`}`;
  if (context.mode === 'repository-summary') return renderSummaryFact(context, evidence, pointer);
  return renderFileFact(context, evidence, pointer);
}

function renderSummaryFact(
  context: Extract<RepositoryContext, { mode: 'repository-summary' }>,
  evidence: EvidenceReference,
  pointer: string,
): string {
  if (evidence.source === 'repository') return `${pointer} is ${textValue(context.repository[evidence.field as 'name' | 'branch' | 'sourceType'])}.`;
  if (evidence.source === 'ast') return `${pointer} is ${textValue(context.ast[evidence.field as keyof typeof context.ast])}.`;
  if (evidence.source === 'dependencies') {
    return `${pointer} is ${textValue(context.dependencies[evidence.field as keyof typeof context.dependencies])}.`;
  }
  if (evidence.source === 'history') return `${pointer} is ${textValue(context.history[evidence.field as keyof typeof context.history])}.`;
  if (evidence.field === 'rule' && evidence.index !== null) {
    const rule = context.static.rules[evidence.index];
    if (!rule) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    return `${pointer} is rule ${rule.ruleId} with severity ${rule.severity}, category ${rule.category ?? 'none'}, and count ${rule.count}.`;
  }
  const staticField = evidence.field === 'staticTruncated' ? 'truncated' : evidence.field;
  const staticMap: Record<string, string | number | boolean> = {
    filesAnalyzed: context.static.filesAnalyzed,
    findingCount: context.static.findingCount,
    errorCount: context.static.errorCount,
    warningCount: context.static.warningCount,
    truncated: context.static.truncated,
    repositoryConfigUsed: context.static.repositoryConfigUsed,
    ruleSet: context.static.ruleSet,
    issueCountExecution: context.static.issueCounts.execution,
    issueCountParse: context.static.issueCounts.parse,
    issueCountLimit: context.static.issueCounts.limit,
  };
  if (!(staticField in staticMap)) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
  return `${pointer} is ${textValue(staticMap[staticField])}.`;
}

function renderFileFact(
  context: Exclude<RepositoryContext, { mode: 'repository-summary' }>,
  evidence: EvidenceReference,
  pointer: string,
): string {
  const filePath = context.file.path;
  if (evidence.source === 'repository') {
    if (context.mode === 'experiment-file-baseline') throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    return `${pointer} is ${textValue(context.repository[evidence.field as 'name' | 'branch' | 'sourceType'])}.`;
  }
  if (evidence.source === 'ast') {
    if (evidence.field === 'path') return `${pointer} is ${filePath}.`;
    if (evidence.field === 'fileTruncated') return `${pointer} is ${context.file.truncated}.`;
    if (!context.file.ast) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    if (evidence.field === 'function' && evidence.index !== null) {
      const fn = context.file.ast.functions[evidence.index];
      if (!fn) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
      return `${pointer} is function ${fn.name ?? 'anonymous'} at line ${fn.line} with nesting depth ${fn.nestingDepth}.`;
    }
    const astValue = context.file.ast[evidence.field as keyof typeof context.file.ast];
    if (typeof astValue === 'object') throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    return `${pointer} is ${textValue(astValue)}.`;
  }
  if (evidence.source === 'static') {
    if (evidence.field === 'finding' && evidence.index !== null) {
      const finding = context.file.static.findings[evidence.index];
      if (!finding) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
      const line = finding.line === null ? 'an unknown line' : `line ${finding.line}`;
      const column = finding.column === null ? 'an unknown column' : `column ${finding.column}`;
      return `${finding.path} has a ${finding.ruleId} finding at ${line}, ${column}: ${finding.message}`;
    }
    if (evidence.field === 'issue' && evidence.index !== null) {
      const issue = context.file.static.issues[evidence.index];
      if (!issue) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
      return `${pointer} is a ${issue.kind} issue: ${issue.message}`;
    }
    if (evidence.field === 'repositoryTruncated' && 'repositoryTruncated' in context.file.static) {
      return `${pointer} is ${context.file.static.repositoryTruncated}.`;
    }
    const staticScalars = {
      repositoryConfigUsed: context.file.static.repositoryConfigUsed,
      ruleSet: context.file.static.ruleSet,
      findingsTruncated: context.file.static.findingsTruncated,
    };
    if (evidence.field in staticScalars) return `${pointer} is ${textValue(staticScalars[evidence.field as keyof typeof staticScalars])}.`;
    throw unsupportedReference(evidence.source, evidence.field, evidence.index);
  }
  if (evidence.source === 'dependencies') {
    if (context.mode === 'experiment-file-baseline') throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    const dependencies = context.mode === 'file' ? context.file.dependencies : context.dependencies;
    if (evidence.field === 'dependenciesTruncated') return `${pointer} is ${dependencies.truncated}.`;
    if (evidence.index === null) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    if (evidence.field === 'outgoing') {
      const edge = dependencies.outgoing[evidence.index];
      if (!edge) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
      return `${filePath} has an outgoing ${edge.kind} relationship to ${edge.path} with specifier ${edge.importSpecifier}.`;
    }
    if (evidence.field === 'incoming') {
      const edge = dependencies.incoming[evidence.index];
      if (!edge) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
      return `${filePath} has an incoming ${edge.kind} relationship from ${edge.path} with specifier ${edge.importSpecifier}.`;
    }
    if (evidence.field === 'external') {
      const edge = dependencies.external[evidence.index];
      if (!edge) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
      return `${filePath} has an external ${edge.kind} dependency on ${edge.name} with specifier ${edge.importSpecifier}.`;
    }
    const item = dependencies.unresolved[evidence.index];
    if (!item || evidence.field !== 'unresolved') throw unsupportedReference(evidence.source, evidence.field, evidence.index);
    return `${filePath} has an unresolved ${item.kind} import ${item.importSpecifier}: ${item.message}`;
  }
  if (context.mode === 'experiment-file-baseline') throw unsupportedReference(evidence.source, evidence.field, evidence.index);
  const history = context.mode === 'file' ? context.file.history : context.history;
  if (!history) throw unsupportedReference(evidence.source, evidence.field, evidence.index);
  const historyValue = history[evidence.field as keyof typeof history];
  return `${pointer} is ${textValue(historyValue)}.`;
}

function textValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return String(value);
}

function unsupportedReference(source: string, field: string, index: number | null): LlmError {
  const pointer = `${source}.${field}${index === null ? '' : `[${index}]`}`;
  return new LlmError('INVALID_RESPONSE', `The AI provider cited evidence that is not in the supplied context (${pointer}).`);
}

function validationError(kind: 'invalid_json' | 'schema' | 'bounds' | 'unsupported_evidence'): LlmError {
  if (kind === 'invalid_json') return new LlmError('INVALID_RESPONSE', 'The AI provider returned invalid JSON.');
  if (kind === 'schema') return new LlmError('INVALID_RESPONSE', 'The AI provider returned output that does not match the response schema.');
  if (kind === 'bounds') return new LlmError('INVALID_RESPONSE', 'The AI provider returned output outside the allowed bounds.');
  return new LlmError('INVALID_RESPONSE', 'The AI provider cited evidence that is not in the supplied context.');
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isEvidenceSource(value: unknown): value is EvidenceSource {
  return EVIDENCE_SOURCES.some((source) => source === value);
}

function isEvidenceField(value: unknown): value is (typeof EVIDENCE_FIELDS)[number] {
  return EVIDENCE_FIELDS.some((field) => field === value);
}

function isConfidence(value: unknown): value is AiConfidence {
  return value === 'low' || value === 'medium' || value === 'high';
}

function preserveContextLimitations(context: RepositoryContext, interpretation: AiInterpretation): AiInterpretation {
  const limitations = [...interpretation.limitations];
  const mentioned = limitations.join(' ').toLowerCase();
  if (historyIsIncomplete(context) && !/shallow|incomplete|history/.test(mentioned)) {
    limitations.push('Git history in the supplied context is shallow or incomplete.');
  }
  if (parseCoverageIsIncomplete(context) && !/parse/.test(limitations.join(' ').toLowerCase())) {
    limitations.push('Some source files could not be parsed, so AST coverage is incomplete.');
  }
  if (dependenciesAreUnresolved(context) && !/unresolved|dependenc/.test(limitations.join(' ').toLowerCase())) {
    limitations.push('Some dependency references could not be resolved.');
  }
  for (const item of context.limitations) {
    if (item.source !== 'static') continue;
    const marker = item.message.slice(0, 48).toLowerCase();
    const already = limitations.join(' ').toLowerCase();
    if (marker !== '' && !already.includes(marker)) {
      const text = item.message.length <= MAX_TEXT ? item.message : item.message.slice(0, MAX_TEXT);
      limitations.push(text);
    }
  }
  const required = limitations.slice(interpretation.limitations.length);
  const room = Math.max(0, MAX_LIMITATIONS - required.length);
  return {
    ...interpretation,
    limitations: [...interpretation.limitations.slice(0, room), ...required].slice(0, MAX_LIMITATIONS),
  };
}

function historyIsIncomplete(context: RepositoryContext): boolean {
  if (context.mode === 'repository-summary') {
    return context.history.historyDepth === 'shallow' || !context.history.isComplete;
  }
  if (context.mode === 'experiment-file-baseline') return false;
  if (context.mode === 'experiment-file-proposed') {
    if (context.history) {
      return context.history.historyDepth === 'shallow' || !context.history.isComplete;
    }
    return context.limitations.some((item) => item.source === 'history');
  }
  if (context.file.history) {
    return context.file.history.historyDepth === 'shallow' || !context.file.history.isComplete;
  }
  return context.limitations.some((item) => item.source === 'history');
}

function parseCoverageIsIncomplete(context: RepositoryContext): boolean {
  if (context.mode === 'repository-summary') return context.ast.parseErrors > 0;
  return context.file.ast === null;
}

function dependenciesAreUnresolved(context: RepositoryContext): boolean {
  if (context.mode === 'repository-summary') return context.dependencies.unresolvedImports > 0;
  if (context.mode === 'experiment-file-baseline') return false;
  if (context.mode === 'experiment-file-proposed') return context.dependencies.unresolved.length > 0;
  return context.file.dependencies.unresolved.length > 0;
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof APIConnectionTimeoutError) {
    return new LlmError('TIMEOUT', 'The AI provider timed out.');
  }
  if (error instanceof RateLimitError) {
    return new LlmError('RATE_LIMIT', 'The AI provider rate limit was reached.');
  }
  if (error instanceof AuthenticationError) {
    return new LlmError('UNAVAILABLE', 'The AI provider rejected the credentials.');
  }
  if (error instanceof APIConnectionError) {
    return new LlmError('UNAVAILABLE', 'The AI provider could not be reached.');
  }
  if (error instanceof APIError) {
    return new LlmError('UNAVAILABLE', 'The AI provider request failed.');
  }
  return new LlmError('UNAVAILABLE', 'The AI provider request failed.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
