export const INDEPENDENT_EVALUATION_MODE = "independent_codex_rubric_v1";
export const FINAL_JUDGE_COUNT = 3;

export type EvaluationRubric = {
  motifRecognizability: number;
  requiredParts: number;
  proportionBalance: number;
  referenceSimilarity: number | null;
};

type EvaluationLike = {
  mode?: unknown;
  passed?: unknown;
  physical?: {
    foldCompleted?: unknown;
    forbiddenOperationsAbsent?: unknown;
    violationFree?: unknown;
    passed?: unknown;
  } | null;
  rubric?: Partial<EvaluationRubric> | null;
  judges?: {
    count?: unknown;
    passVotes?: unknown;
    requiredVotes?: unknown;
    aggregation?: unknown;
  } | null;
};

function validRubricScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5;
}

export function evaluatedRubric(evaluation: EvaluationLike | null | undefined): EvaluationRubric | null {
  if (evaluation?.mode !== INDEPENDENT_EVALUATION_MODE) return null;
  const rubric = evaluation.rubric;
  if (!rubric
    || !validRubricScore(rubric.motifRecognizability)
    || !validRubricScore(rubric.requiredParts)
    || !validRubricScore(rubric.proportionBalance)
    || !(rubric.referenceSimilarity === null || validRubricScore(rubric.referenceSimilarity))) return null;
  return rubric as EvaluationRubric;
}

export function hasPassedIndependentEvaluation(evaluation: EvaluationLike | null | undefined) {
  const rubric = evaluatedRubric(evaluation);
  const judges = evaluation?.judges;
  return rubric !== null
    && evaluation?.passed === true
    && evaluation?.physical?.passed === true
    && evaluation.physical.foldCompleted === true
    && evaluation.physical.forbiddenOperationsAbsent === true
    && evaluation.physical.violationFree === true
    && judges?.count === FINAL_JUDGE_COUNT
    && typeof judges.passVotes === "number"
    && typeof judges.requiredVotes === "number"
    && judges.passVotes >= judges.requiredVotes
    && judges.aggregation === "median_and_majority";
}
