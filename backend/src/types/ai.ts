export type AiConfidence = 'low' | 'medium' | 'high';

export type EvidenceSource = 'ast' | 'static' | 'dependencies' | 'history' | 'repository';

/**
 * A pointer into the context that was sent to the model.
 * `index` selects one list item. It is null for a scalar field.
 */
export interface EvidenceReference {
  source: EvidenceSource;
  field: string;
  index: number | null;
}

export interface AiObservation {
  category: string;
  /** Server-rendered fact from the cited evidence. The model does not write this. */
  observation: string;
  /** Model inference. This text is labeled as interpretation and is not fact-checked. */
  interpretation: string;
  evidence: EvidenceReference[];
  confidence: AiConfidence;
}

export interface AiInterpretation {
  summary: string;
  observations: AiObservation[];
  limitations: string[];
}

/** HTTP wrapper for an experimental condition. The interpretation schema is unchanged. */
export interface ExperimentAiResponse {
  condition: 'baseline' | 'proposed';
  contextMode: 'experiment-file-baseline' | 'experiment-file-proposed';
  path: string;
  model: string;
  interpretation: AiInterpretation;
}
