export function buildReferenceDocument({
  prompt,
  catalog,
  works = [],
  images = [],
  structures = [],
} = {}) {
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
      pattern_count: 5157,
      candidates: structures,
      use: "initial_structure_reference_only",
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
      structural_candidates: structures.map(({ id, title, family, params, reason, score }) => ({
        id, title, family, params, reason, score,
      })),
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

export function chooseValidatedInitialFold(structuralMatches = [], validations = [], fallbackFold) {
  const passed = validations.find(({ status, oriedita_completed: completed, violation_count: violations }) =>
    status === "passed" && completed === true && Number(violations) === 0);
  const selectedIndex = passed
    ? structuralMatches.findIndex(({ pattern }) => pattern.id === passed.pattern_id)
    : -1;
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
