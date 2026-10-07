/**
 * BL-AIX Phase 1b — every AI feature's prompt, rendered from fixed
 * fixtures for tests/ai/prompt-versions.test.ts.
 *
 * Fixtures fill the optional blocks too, so a change to conditional
 * instructions (voice, citations, pattern intel…) changes the hash.
 * PROMPT_SCHEMAS lists the output schemas structured calls send, since
 * their field descriptions are instructions too. Adding a feature means
 * adding it to both maps; the test fails until every prompted feature
 * has an entry.
 */
import type { z } from "zod";
import type { AIMessage } from "@/lib/ai";
import type { PromptedFeature } from "@/lib/ai-prompt-versions";
import {
  artifactKindClassifySchema,
  brainAnswerSchema,
  buildArtifactKindClassifyPrompt,
  buildBrainAnswerPrompt,
  buildCapabilityMatrixPrompt,
  buildCitationVerifyPrompt,
  buildComplianceAutoMapPrompt,
  buildCompliancePreflightPrompt,
  buildEbuyExtractPrompt,
  buildGraphicsSuggestPrompt,
  buildGoldAnnotatePrompt,
  buildGsaExtractPrompt,
  buildImageOcrPrompt,
  buildKnowledgeExtractPrompt,
  buildOnboardingAssistPrompt,
  buildOpportunityBriefPrompt,
  buildPipelineBriefPrompt,
  buildProposalBootstrapPrompt,
  buildProtestViabilityPrompt,
  buildQuestionGeneratorPrompt,
  buildRequirementsChunkPrompt,
  buildReviewPreflightPrompt,
  buildReviewSummaryPrompt,
  buildScoutTriagePrompt,
  buildSectionDraftPrompt,
  buildSolicitationExtractPrompt,
  buildSolicitationReviewPrompt,
  buildSolicitationVisionPrompt,
  buildWinnerAnalysisPrompt,
  citationVerifySchema,
  complianceAutoMapResponseSchema,
  compliancePreflightResponseSchema,
  ebuyExtractionSchema,
  graphicsSuggestSchema,
  goldAnnotateSchema,
  gsaExtractionSchema,
  knowledgeExtractionSchema,
  onboardingAssistSchema,
  pipelineBriefSchema,
  proposalBootstrapSchema,
  proposalScanSchema,
  protestViabilitySchema,
  pursuitBriefSchema,
  requirementsChunkSchema,
  reviewPreflightSchema,
  reviewSummarySchema,
  scoutTriageSchema,
  SECTION_CHAT_SYSTEM,
  solicitationExtractionSchema,
  winnerAnalysisSchema,
  type SectionDraftSnapshot,
  type SolicitationReviewVerdict,
} from "@/lib/ai-prompts";
import { capabilityMatrixSchema, questionSetSchema, solicitationReviewSchema } from "@/lib/ai-prompts-bl23";
import { buildLossNarrativePrompt, lossNarrativeSchema } from "@/lib/ai-prompts-loss";
import { buildScanUserPrompt, SCAN_SYSTEM } from "@/lib/proposal-scan-input";
import { fromPlainText } from "@/lib/tiptap-doc";

export type RenderedPrompt = { system: string; messages: AIMessage[] };

const RFP_TEXT = [
  "SECTION C — STATEMENT OF WORK",
  "C.1 The contractor shall migrate 40 legacy applications to a FedRAMP High cloud.",
  "C.2 The contractor shall provide 24x7 operations support.",
  "SECTION L — INSTRUCTIONS TO OFFERORS",
  "L.5.2.1 Volume I Technical shall not exceed 25 pages and shall describe the migration approach.",
  "SECTION M — EVALUATION FACTORS FOR AWARD",
  "M.2 Technical approach is more important than past performance, which is more important than price.",
].join("\n");

const REQUIREMENTS = [
  { kind: "shall", text: "Migrate 40 legacy applications to a FedRAMP High cloud.", ref: "C.1" },
  { kind: "shall", text: "Describe the migration approach in Volume I.", ref: "L.5.2.1" },
];

const draftSnapshot: SectionDraftSnapshot = {
  organizationName: "Acme Federal",
  proposal: {
    title: "Cloud migration support",
    agency: "GSA",
    solicitationNumber: "47QT-26-R-0001",
    naicsCode: "541512",
    setAside: "8(a)",
    incumbent: "Legacy Corp",
    opportunityDescription: "Migrate legacy workloads to a FedRAMP High cloud.",
  },
  section: {
    title: "Technical Approach",
    kind: "technical",
    pageLimit: 5,
    instructions: "Describe the migration approach and its risk controls.",
    authorGuidance: 'Replace "leverage" (×1 — use).',
    currentBodyPlain: "We leverage a phased approach with rollback at every wave.",
    currentWordCount: 10,
  },
  pastPerformance: [{ customer: "DHS", contract: "70RTAC-21-C-0001", description: "Migrated 32 applications with zero downtime." }],
  patternIntel: {
    winningPatterns: [{ excerpt: "Our three-wave approach held downtime to zero.", provenance: "Won — DOE, 2025" }],
    lostPatterns: [{ excerpt: "We are a world-class provider of robust solutions." }],
    complianceGaps: [{ requirementNumber: "L.5.2.1", requirementText: "Describe rollback.", gap: "No rollback plan.", suggestion: "Add a rollback step per wave." }],
    sectionSignal: { wonPassRate: 0.8, lostPassRate: 0.4, sampleSize: 12 },
    editFeedback: {
      sampleSize: 20,
      windowDays: 90,
      insertAcceptRate: 0.6,
      deleteAcceptRate: 0.7,
      preferredPhrases: ["three waves, each reversible"],
      rejectedPhrases: ["best-in-class"],
      removedPhrases: ["we are pleased to"],
      aiSuggestionAcceptRate: 0.4,
      aiDecisions: 8,
    },
    writingSignals: {
      draftAcceptance: { drafts: 6, meanAcceptedFraction: 0.5, widened: false },
      reviewComments: [{ color: "pink", body: "Say who approves each wave.", reviewer: "Pat" }],
      debriefWeaknesses: [{ agency: "GSA", weaknesses: "Thin risk register.", improvements: "Name owners." }],
      winnerGaps: [{ competitor: "Beta Corp", agency: "GSA", gaps: "No automation metrics.", recommendations: "Quantify automation." }],
    },
  },
  solicitation: {
    sectionLSummary: "Volume I Technical, 25 pages.",
    sectionMSummary: "Technical approach is most important.",
    requirements: REQUIREMENTS,
    mappedRequirements: [{ number: "L.5.2.1", text: "Describe the migration approach.", category: "section_l" }],
    totalRequirements: 2,
  },
  winThemes: [{ title: "Zero downtime", statement: "Every wave can be rolled back within an hour." }],
  sources: [
    { index: 1, kind: "past_performance", label: "DHS migration", excerpt: "Migrated 32 applications with zero downtime.", outcomeLabel: "won" },
    { index: 2, kind: "corpus", label: "DOE proposal", excerpt: "Three reversible waves." },
  ],
  customerVoice: { agency: "GSA", phrases: [{ phrase: "mission continuity", source: "evaluation" }] },
  authorVoice: { author: "Pat", guidance: "Short declarative sentences; numbers first." },
};

const reviewVerdictRequirements: SolicitationReviewVerdict["requirements"] = [
  { id: "R1", kind: "shall", text: "Migrate 40 legacy applications.", sectionRef: "C.1", capabilityArea: "Cloud Migration" },
];

const debrief = {
  strengths: "Strong transition plan.",
  weaknesses: "Thin risk register.",
  improvements: "Name risk owners.",
  pastPerformanceCitation: "DHS migration",
  notes: "Price was 8% above the awardee.",
};

export const PROMPT_RENDERERS: Record<PromptedFeature, () => RenderedPrompt[]> = {
  opportunity_brief: () => [
    buildOpportunityBriefPrompt({
      organizationName: "Acme Federal",
      asOf: "2026-10-05",
      opportunity: {
        title: "Cloud migration support",
        agency: "GSA",
        office: "FAS",
        stage: "capture",
        solicitationNumber: "47QT-26-R-0001",
        naicsCode: "541512",
        pscCode: "DA01",
        setAside: "8(a)",
        contractType: "FFP",
        placeOfPerformance: "Washington, DC",
        incumbent: "Legacy Corp",
        valueLow: "$10M",
        valueHigh: "$25M",
        pwin: 45,
        daysToDue: 30,
        description: "Migrate legacy workloads.",
      },
      evaluation: {
        rollupScore: 3.6,
        strategicFit: 4,
        customerRelationship: 3,
        competitivePosture: 3,
        resourceAvailability: 4,
        financialAttractiveness: 4,
        rationale: "Core capability, known customer.",
      },
      competitors: [{ name: "Legacy Corp", isIncumbent: true, strengths: "Knows the estate.", weaknesses: "Late deliveries.", notes: "" }],
      recentActivity: [{ kind: "call", title: "Industry day", body: "CO stressed FedRAMP High.", daysAgo: 3 }],
      modelPwin: { pwin: 0.42, confidence: "medium", factors: [{ label: "Incumbent", detail: "Strong incumbent.", direction: "down" }], track: { n: 20, brier: 0.18 } },
      recompete: [{ title: "Cloud migration 2021", outcome: "lost", decidedAt: "2021-06-01", awardedTo: "Legacy Corp", confidence: "high", lessonsLearned: "Price higher.", weaknesses: "Thin risk register." }],
      customer: { agency: "GSA", pursuits: 5, won: 2, lost: 3, winRate: 0.4, winners: [{ name: "Legacy Corp", count: 2 }], evaluatorPriorities: ["mission continuity"] },
      lossPatterns: [{ title: "Price above awardee", severity: "high", detail: "Lost 3 of 4 on price." }],
      brainHits: [{ title: "DOE proposal", excerpt: "Three reversible waves.", outcomeLabel: "won" }],
    }),
  ],
  pipeline_brief: () => [
    buildPipelineBriefPrompt({
      organizationName: "Acme Federal",
      asOf: "2026-10-05",
      opportunities: {
        total: 4,
        byStage: { capture: 2, proposal: 2 },
        topByPwin: [{ title: "Cloud migration support", agency: "GSA", stage: "capture", pwin: 45, dueDate: "2026-11-04" }],
        upcomingDueWithin14Days: [{ title: "Help desk", agency: "VA", dueDate: "2026-10-12" }],
      },
      proposals: { total: 2, byStage: { drafting: 1, review: 1 }, inActiveReview: 1 },
      modelTrack: { n: 20, brier: 0.18 },
      lossIntel: { decided: 10, winRate: 0.4, patterns: [{ title: "Price above awardee", severity: "high", detail: "Lost 3 of 4 on price." }], topCompetitors: [{ name: "Legacy Corp", count: 3 }] },
    }),
  ],
  section_draft: () => [
    buildSectionDraftPrompt("draft", draftSnapshot),
    buildSectionDraftPrompt("improve", draftSnapshot),
    buildSectionDraftPrompt("tighten", draftSnapshot),
    buildSectionDraftPrompt("draft_alt", draftSnapshot),
    buildCitationVerifyPrompt({ claims: [{ id: 1, claim: "We migrated 32 applications [S1].", sources: [{ index: 1, excerpt: "Migrated 32 applications." }] }] }),
  ],
  section_chat: () => [{ system: SECTION_CHAT_SYSTEM, messages: [] }],
  proposal_scan: () => [scanPrompt()],
  proposal_scan_background: () => [scanPrompt()],
  compliance_preflight: () => [
    buildCompliancePreflightPrompt({
      sectionTitle: "Technical Approach",
      sectionKind: "technical",
      sectionBody: "We migrate in three reversible waves.",
      items: [{ id: "i1", number: "L.5.2.1", category: "section_l", requirementText: "Describe the migration approach." }],
    }),
  ],
  compliance_automap: () => [
    buildComplianceAutoMapPrompt({
      items: [{ itemId: "i1", number: "L.5.2.1", category: "section_l", requirementText: "Describe the migration approach." }],
      sections: [{ sectionId: "s1", title: "Technical Approach", kind: "technical" }],
    }),
  ],
  winner_analysis: () => [
    buildWinnerAnalysisPrompt({
      proposalTitle: "Cloud migration support",
      agency: "GSA",
      solicitationNumber: "47QT-26-R-0001",
      naicsCode: "541512",
      setAside: "8(a)",
      ourSubmissionSummary: "Three reversible waves.",
      outcome: { awardValue: "$18M", decisionDate: "2026-09-01", summary: "Lost on price.", lessonsLearned: "Sharpen price.", awardedToCompetitor: "Beta Corp" },
      debrief,
      competitorAwards: [{ piid: "47QT-22-C-0002", agency: "GSA", value: "$12M", periodStart: "2022-01-01", periodEnd: "2026-12-31", description: "Cloud hosting." }],
    }),
  ],
  protest_viability: () => [
    buildProtestViabilityPrompt({
      proposalTitle: "Cloud migration support",
      agency: "GSA",
      solicitationNumber: "47QT-26-R-0001",
      naicsCode: "541512",
      setAside: "8(a)",
      sectionMSummary: "Technical approach is most important.",
      sectionLSummary: "Volume I Technical, 25 pages.",
      debrief,
      outcome: { awardedToCompetitor: "Beta Corp", decisionDate: "2026-09-01", summary: "Lost on price." },
    }),
  ],
  solicitation_extract: () => [
    buildSolicitationExtractPrompt(RFP_TEXT),
    buildSolicitationVisionPrompt(),
    buildRequirementsChunkPrompt({ chunkText: RFP_TEXT, chunkIndex: 0, chunkCount: 2, documentLabel: "RFP.pdf" }),
  ],
  solicitation_review: () => [buildSolicitationReviewPrompt({ title: "Cloud migration support", fileName: "RFP.pdf", rawText: RFP_TEXT })],
  capability_matrix: () => [
    buildCapabilityMatrixPrompt({
      solicitationTitle: "Cloud migration support",
      agency: "GSA",
      setAside: "8(a)",
      requirements: reviewVerdictRequirements,
      knowledgeEntries: [{ id: "k1", kind: "capability", title: "Cloud migration", body: "32 applications migrated for DHS.", tags: ["cloud"] }],
    }),
  ],
  question_generator: () => [
    buildQuestionGeneratorPrompt({
      solicitationTitle: "Cloud migration support",
      agency: "GSA",
      reviewSummary: "Large migration with a tight page limit.",
      sectionL: ["Volume I Technical, 25 pages."],
      sectionM: ["Technical approach is most important."],
      requirements: reviewVerdictRequirements,
      evaluationFactors: [{ name: "Technical approach", weight: "most important", notes: "" }],
      flaggedQuestions: ["Is the 25-page limit inclusive of resumes?"],
    }),
  ],
  ebuy_extract: () => [buildEbuyExtractPrompt(RFP_TEXT)],
  gsa_extract: () => [buildGsaExtractPrompt(RFP_TEXT)],
  image_ocr: () => [buildImageOcrPrompt()],
  knowledge_classify: () => [buildArtifactKindClassifyPrompt({ fileName: "DHS-migration.pdf", contentType: "application/pdf", rawText: "Past performance: DHS migration." })],
  knowledge_extract: () => [
    buildKnowledgeExtractPrompt({ artifactKind: "won_proposal", artifactTitle: "DOE proposal", artifactTags: ["cloud"], rawText: "Three reversible waves held downtime to zero." }),
  ],
  loss_intelligence: () => [
    buildLossNarrativePrompt({
      organizationName: "Acme Federal",
      intel: {
        decided: 10,
        won: 4,
        lost: 6,
        winRate: 0.4,
        lossesWithDebrief: 3,
        reasonTotals: [{ reason: "price", label: "Price", count: 3 }],
        patterns: [{ id: "price", kind: "price", severity: "high", title: "Price above awardee", detail: "Lost 3 of 4 on price.", evidence: [{ proposalId: "p1", title: "Help desk", decidedAt: "2026-05-01" }] }],
        competitors: [{ name: "Beta Corp", faced: 4, lostTo: 3, wonAgainst: 1, leadingReason: "price", lastLossAt: "2026-05-01", agencies: ["GSA"] }],
      },
    }),
  ],
  review_preflight: () => [
    buildReviewPreflightPrompt({
      color: "red",
      sectionTitle: "Technical Approach",
      sectionKind: "technical",
      pageLimit: 5,
      wordCount: 10,
      body: "We migrate in three reversible waves.",
      requirements: [{ number: "L.5.2.1", text: "Describe the migration approach." }],
      winThemes: [{ title: "Zero downtime", statement: "Every wave can be rolled back within an hour." }],
      evaluation: { summary: "Technical approach is most important.", factors: ["Technical approach — most important"] },
    }),
  ],
  proposal_bootstrap: () => [
    buildProposalBootstrapPrompt({
      organizationName: "Acme Federal",
      opportunity: { title: "Cloud migration support", agency: "GSA", solicitationNumber: "47QT-26-R-0001", naicsCode: "541512", setAside: "8(a)" },
      sectionLSummary: "Volume I Technical, 25 pages.",
      sectionMSummary: "Technical approach is most important.",
      sectionLText: "L.5.2.1 Volume I Technical shall not exceed 25 pages.",
      requirements: REQUIREMENTS,
      keyDates: [{ label: "Proposals due", isoDate: "2026-11-04", type: "response_due" }],
      responseDueDate: "2026-11-04",
    }),
  ],
  opportunity_triage: () => [
    buildScoutTriagePrompt({
      organizationName: "Acme Federal",
      asOf: "2026-10-05",
      organization: { primaryNaics: "541512", naicsList: ["541512", "541519"], setAsides: ["8(a)"], keywords: ["cloud migration"] },
      candidate: {
        source: "keyword",
        title: "Cloud migration support",
        agency: "GSA",
        office: "FAS",
        noticeType: "Solicitation",
        solicitationNumber: "47QT-26-R-0001",
        naicsCode: "541512",
        pscCode: "DA01",
        setAside: "8(a)",
        incumbent: "Legacy Corp",
        postedAt: "2026-10-01",
        responseDueAt: "2026-11-04",
        daysToDue: 30,
        placeOfPerformance: "Washington, DC",
        description: "Migrate legacy workloads.",
      },
      fitScore: 72,
      signals: ["NAICS match", "keyword: cloud migration"],
      recompete: { title: "Cloud migration 2021", outcome: "lost", awardedTo: "Legacy Corp", lessons: "Price higher." },
      customer: { pursuits: 5, won: 2, lost: 3, winRate: 0.4 },
      history: { imported: ["Help desk"], dismissed: ["Janitorial"], track: { n: 12, accuracy: 0.75 } },
    }),
  ],
  brain_answer: () => [
    buildBrainAnswerPrompt({
      question: "What downtime did we achieve on the DHS migration?",
      sources: [{ n: 1, title: "DHS migration", source: "entry", kind: "past_performance", outcomeLabel: "won", excerpt: "Zero downtime across 32 applications." }],
    }),
  ],
  onboarding_assist: () => [
    buildOnboardingAssistPrompt({
      name: "Acme Federal",
      state: "VA",
      website: "https://acme.example",
      primaryNaics: "541512",
      naicsList: ["541512", "541519"],
      certifications: ["8(a)"],
      sbaDescriptions: ["8(a) Business Development"],
    }),
  ],
  graphics_suggest: () => [
    buildGraphicsSuggestPrompt({ title: "Technical Approach", kind: "technical", agency: "GSA", text: "Wave 1 assesses, wave 2 migrates, wave 3 decommissions." }),
  ],
  review_summary: () => [buildReviewSummaryPrompt({ report: "Pink team: 4 comments on Technical Approach.", uncheckedLabels: ["Page limits checked"] })],
  gold_annotate: () => [buildGoldAnnotatePrompt({ title: "Cloud migration support", windowText: RFP_TEXT, windowIndex: 0, windowCount: 3 })],
};

/** What structured calls hand the model as their output tool, per feature. */
export const PROMPT_SCHEMAS: Record<PromptedFeature, z.ZodType[]> = {
  opportunity_brief: [pursuitBriefSchema],
  pipeline_brief: [pipelineBriefSchema],
  section_draft: [citationVerifySchema],
  section_chat: [],
  proposal_scan: [proposalScanSchema],
  proposal_scan_background: [proposalScanSchema],
  compliance_preflight: [compliancePreflightResponseSchema],
  compliance_automap: [complianceAutoMapResponseSchema],
  winner_analysis: [winnerAnalysisSchema],
  protest_viability: [protestViabilitySchema],
  solicitation_extract: [solicitationExtractionSchema, requirementsChunkSchema],
  solicitation_review: [solicitationReviewSchema],
  capability_matrix: [capabilityMatrixSchema],
  question_generator: [questionSetSchema],
  ebuy_extract: [ebuyExtractionSchema],
  gsa_extract: [gsaExtractionSchema],
  image_ocr: [],
  knowledge_classify: [artifactKindClassifySchema],
  knowledge_extract: [knowledgeExtractionSchema],
  loss_intelligence: [lossNarrativeSchema],
  review_preflight: [reviewPreflightSchema],
  proposal_bootstrap: [proposalBootstrapSchema],
  opportunity_triage: [scoutTriageSchema],
  brain_answer: [brainAnswerSchema],
  onboarding_assist: [onboardingAssistSchema],
  graphics_suggest: [graphicsSuggestSchema],
  review_summary: [reviewSummarySchema],
  gold_annotate: [goldAnnotateSchema],
};

function scanPrompt(): RenderedPrompt {
  const user = buildScanUserPrompt({
    proposalTitle: "Cloud migration support",
    agency: "GSA",
    solicitationNumber: "47QT-26-R-0001",
    naicsCode: "541512",
    setAside: "8(a)",
    winThemes: [{ title: "Zero downtime", statement: "Every wave can be rolled back within an hour." }],
    sectionMSummary: "Technical approach is most important.",
    requirements: REQUIREMENTS,
    sections: [
      {
        id: "s1",
        title: "Technical Approach",
        kind: "technical",
        status: "in_progress",
        wordCount: 7,
        pageLimit: 5,
        bodyDoc: fromPlainText("We migrate in three reversible waves."),
        content: null,
      },
    ],
  });
  return { system: SCAN_SYSTEM, messages: [{ role: "user", content: JSON.stringify(user) }] };
}
