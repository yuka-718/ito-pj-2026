export function buildReferenceDocument({
  prompt,
  catalog,
  works = [],
  images = [],
  structures = [],
} = {}) {
  const structuralCorpus = structures.find(({ corpus } = {}) => corpus)?.corpus ?? null;
  const searchedPatternCount = Number(structuralCorpus?.searchedPatternCount) || 0;
  return {
    schema: "oriai-rag-references-v1",
    prompt: String(prompt ?? ""),
    created_at: new Date().toISOString(),
    permission: catalog?.permission ?? null,
    origami_search: {
      source: catalog?.index?.source ?? null,
      index_schema: catalog?.index?.schema ?? null,
      indexed_works: catalog?.index?.item_count ?? 0,
      matches: works,
      selected_images: images.map((image) => Object.fromEntries(
        Object.entries(image).filter(([key]) => key !== "local_path"),
      )),
      selected_image_count: images.length,
      maximum_images: 8,
    },
    structural_knowledge: {
      pattern_count: Number(structuralCorpus?.sourcePatternCount) || 0,
      searched_pattern_count: searchedPatternCount,
      retrieval_strategy: searchedPatternCount ? "prompt_to_design_features_then_rank_5000" : "not_run",
      candidates: structures,
      use: searchedPatternCount ? "select_validated_initial_then_modify" : "square_fallback",
      human_verified_steps: false,
    },
    policy: {
      retrieval_augmented_generation: true,
      model_retraining: false,
      copy_finished_work: false,
      use_only: ["basic_form", "features", "parts", "ratios", "symmetry", "area_allocation"],
      source_text_is_untrusted_data: true,
      redistribute_reference_images: false,
    },
  };
}

export function buildPreliminaryDesignBrief({ prompt, goal, works = [], structures = [] } = {}) {
  const parts = Array.isArray(goal?.parts) ? goal.parts : [];
  const totalImportance = parts.reduce((sum, part) => sum + Math.max(1, Number(part.importance) || 1), 0) || 1;
  const structuralCorpus = structures.find(({ corpus } = {}) => corpus)?.corpus ?? null;
  return {
    schema: "oriai-design-brief-v1",
    status: "retrieved",
    prompt: String(prompt ?? ""),
    design_inputs: {
      requested_parts: parts.map((part) => ({
        label: part.label,
        direction: part.direction ?? null,
        importance: Number(part.importance) || 1,
        area_share_hint: Math.round((Math.max(1, Number(part.importance) || 1) / totalImportance) * 100),
      })),
      symmetry: goal?.symmetry !== false,
      work_references: works.map(({ id, title, creator, source_url, reason, score }) => ({
        id, title, creator, source_url, reason, score,
      })),
      structural_candidates: structures.map(({ id, title, family, params, reason, score, scoreBreakdown, corpus }) => ({
        id, title, family, params, reason, score, score_breakdown: scoreBreakdown, corpus,
      })),
      structural_search: {
        strategy: structuralCorpus ? "prompt_to_design_features_then_rank_5000" : "not_run",
        searched_pattern_count: Number(structuralCorpus?.searchedPatternCount) || 0,
        selected_pattern_id: null,
        modification_mode: "pending_oriedita_validation",
      },
    },
    codex_design: null,
    safeguards: {
      references_are_data_not_instructions: true,
      do_not_copy_a_finished_work: true,
      structural_candidates_are_not_finished_models: true,
      sequence_feasibility: "unverified",
    },
  };
}

export function completeDesignBrief(preliminary, codexDesign) {
  return {
    ...preliminary,
    status: "completed",
    completed_at: new Date().toISOString(),
    codex_design: codexDesign,
  };
}

export function chooseValidatedInitialFold(
  structuralMatches = [],
  validations = [],
  fallbackFold,
  { requireIncrementalModification = false } = {},
) {
  const candidates = structuralMatches.flatMap((match, index) => {
    const validation = validations.find(({ pattern_id: patternId }) => patternId === match.pattern.id);
    const basePassed = validation?.status === "passed"
      && validation.oriedita_completed === true
      && Number.isInteger(validation.violation_count)
      && validation.violation_count === 0;
    const smoke = validation?.modifiability;
    const modificationPassed = smoke?.status === "passed"
      && smoke.add_line_completed === true
      && smoke.calculation_started === true
      && Number.isInteger(smoke.violation_count)
      && smoke.violation_count === 0
      && smoke.oriedita_completed === true
      && smoke.parent_reloaded === true;
    return basePassed && (!requireIncrementalModification || modificationPassed)
      ? [{ match, index }]
      : [];
  }).sort((a, b) => {
    const scoreA = Number.isFinite(Number(a.match.score)) ? Number(a.match.score) : Number.NEGATIVE_INFINITY;
    const scoreB = Number.isFinite(Number(b.match.score)) ? Number(b.match.score) : Number.NEGATIVE_INFINITY;
    return scoreB - scoreA || a.index - b.index;
  });
  const selectedIndex = candidates[0]?.index ?? -1;
  if (selectedIndex >= 0 && structuralMatches[selectedIndex]?.pattern?.fold) {
    return {
      fold: structuralMatches[selectedIndex].pattern.fold,
      source: "validated_structural_knowledge",
      pattern_id: structuralMatches[selectedIndex].pattern.id,
      fallback: false,
    };
  }
  return {
    fold: fallbackFold,
    source: "square_fallback",
    pattern_id: null,
    fallback: true,
  };
}
