/**
 * Heuristic repository indicators.
 * The optional score is a documented formula over analyzer counts.
 * It is not a validated quality metric and is not produced by a language model.
 */
export const HEALTH_SCORE_FORMULA = 'heuristicScore = clamp(0, 100, 100 - min(40, staticErrors * 2 + staticWarnings) - min(20, unresolvedImports) - min(15, astParseErrors) - incompleteHistoryPenalty). incompleteHistoryPenalty is 10 when Git history is present but incomplete, otherwise 0. Inputs from a missing module are omitted and listed in omittedInputs. The score is null when no analysis module succeeded. Technical-debt contribution is reported separately and is not an input.';
const DISCLAIMER = 'This is a heuristic indicator computed from analyzer evidence. It is not a validated quality, risk, or health metric.';
export function buildRepositoryHealth(overview, debt) {
    const omittedInputs = [];
    let penalty = 0;
    let availableInputs = 0;
    if (overview.static) {
        availableInputs += 1;
        penalty += Math.min(40, overview.static.errorCount * 2 + overview.static.warningCount);
    }
    else {
        omittedInputs.push('static findings');
    }
    if (overview.dependencies) {
        availableInputs += 1;
        penalty += Math.min(20, overview.dependencies.unresolvedImports);
    }
    else {
        omittedInputs.push('unresolved imports');
    }
    if (overview.ast) {
        availableInputs += 1;
        penalty += Math.min(15, overview.ast.parseErrors);
    }
    else {
        omittedInputs.push('parse errors');
    }
    if (overview.history) {
        availableInputs += 1;
        if (!overview.history.isComplete)
            penalty += 10;
    }
    else {
        omittedInputs.push('Git history completeness');
    }
    const indicators = [
        indicator('files-analyzed', 'Files analyzed', overview.ast?.totalFiles ?? null),
        indicator('lines-analyzed', 'Lines analyzed', overview.ast?.totalLines ?? null),
        indicator('functions', 'Functions', overview.ast?.totalFunctions ?? null),
        indicator('classes', 'Classes', overview.ast?.totalClasses ?? null),
        indicator('static-findings', 'Static findings', overview.static?.findingCount ?? null),
        indicator('static-errors', 'Static errors', overview.static?.errorCount ?? null),
        indicator('static-warnings', 'Static warnings', overview.static?.warningCount ?? null),
        indicator('dependency-files', 'Dependency files', overview.dependencies?.totalInternalNodes ?? null),
        indicator('internal-edges', 'Internal dependency edges', overview.dependencies?.totalInternalEdges ?? null),
        indicator('external-packages', 'External packages', overview.dependencies?.totalExternalPackages ?? null),
        indicator('unresolved-imports', 'Unresolved imports', overview.dependencies?.unresolvedImports ?? null),
        indicator('git-commits', 'Available Git commits', overview.history?.availableCommits ?? null),
        indicator('git-history', 'Git history', overview.history ? (overview.history.isComplete ? 'complete' : overview.history.historyDepth) : null),
        indicator('debt-indicators', 'Technical debt indicators', debt?.summary.itemCount ?? null),
        indicator('debt-contribution', 'Estimated debt contribution', debt?.summary.estimatedContribution ?? null),
        indicator('analysis-limitations', 'Analysis limitations', overview.readiness.limitations.length),
    ];
    return {
        kind: 'heuristic-indicator',
        disclaimer: DISCLAIMER,
        formula: HEALTH_SCORE_FORMULA,
        indicators,
        heuristicScore: availableInputs === 0 ? null : clamp(100 - penalty),
        omittedInputs,
    };
}
function indicator(id, label, value) {
    return { id, label, value, available: value !== null };
}
function clamp(value) {
    return Math.max(0, Math.min(100, value));
}
