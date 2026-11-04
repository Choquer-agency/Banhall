/**
 * The client questionnaire's questions, in order. Client-facing copy: plain
 * words, plain hyphens only. 2026-10-29 (third), review round 1 (P3-8): the
 * technical problem asks for the usual approach and why it did not work, and
 * the hypothesis asks what they expected and why, never for a measurable
 * outcome or a "no documented methods" claim.
 */
export const QUESTIONS = [
  {
    id: "company_background",
    label: "Company Background",
    question: "Describe your company, industry, and relevant domain expertise. What makes your team qualified to tackle this technical problem?",
    placeholder: "e.g., We are a 50-person horticulture company in BC with 15 years of experience managing multi-species greenhouses...",
    rows: 4,
  },
  {
    id: "project_goal",
    label: "Project Goal",
    question: "What are you trying to build, create, or improve? Describe the physical product, process, or system.",
    placeholder: "e.g., We are developing a custom software system using computer vision and environmental analytics to automatically track plant growth stages...",
    rows: 4,
  },
  {
    id: "business_problem",
    label: "Business Problem",
    question: "What business problem is driving this project? (e.g., reduce costs, enter new market, improve efficiency)",
    placeholder: "e.g., Manual inventory tracking of living plants is error-prone and labor-intensive, costing us X hours per week...",
    rows: 3,
  },
  {
    id: "technical_problem",
    label: "Technical / Scientific Problem",
    question: "What is the technical problem behind it? What is the usual way to solve a problem like this, and why did it not work for you?",
    placeholder: "e.g., Most nurseries track plants with barcode labels and counts by hand. That did not work for us because our plants change size and value every week...",
    rows: 4,
  },
  {
    id: "what_was_tried",
    label: "What Was Tried",
    question: "Describe the approaches, experiments, or iterations your team undertook. What did you try first? What worked? What didn't? What did you change?",
    placeholder: "e.g., First we tried using off-the-shelf image classification models, but they failed because... Then we developed a custom approach where...",
    rows: 6,
  },
  {
    id: "hypothesis",
    label: "Hypothesis",
    question: "What did you expect to happen, and why? For example: if we tried this approach, we expected this result, because...",
    placeholder: "e.g., We expected that adding sensor data to the photos would tell growth stages apart earlier, because each species grows at its own rate...",
    rows: 3,
  },
  {
    id: "what_was_learned",
    label: "What Was Learned",
    question: "What new knowledge or understanding did your team gain? What worked, what didn't, and why?",
    placeholder: "e.g., We determined that temporal image sequences combined with environmental data significantly outperform single-image approaches for species classification...",
    rows: 4,
  },
  {
    id: "remaining_uncertainties",
    label: "Remaining Uncertainties",
    question: "What technical questions remain unresolved? What are you planning to investigate next?",
    placeholder: "e.g., Classification accuracy for early-stage seedlings remains below target. We need to investigate whether transfer learning from related species...",
    rows: 3,
  },
  {
    id: "team_and_timeline",
    label: "Team & Timeline",
    question: "Who worked on this project? Approximately how long did the R&D work take? Is it ongoing?",
    placeholder: "e.g., 3 developers and 1 horticultural scientist worked on this over 8 months. The project is continuing into the next fiscal year...",
    rows: 3,
  },
];
