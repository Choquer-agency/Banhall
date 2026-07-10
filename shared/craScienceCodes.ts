// CRA T4088 Appendix 1 — Field of science or technology codes (Line 206).
// Source: https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4088/guide-form-t661-scientific-research-experimental-development-expenditures-claim-guide-form-t661.html#toc30
export type CraScienceCodeEntry = {
  code: string;
  label: string;
  group: string;
};

export const CRA_SCIENCE_CODES = [
  { code: "1.01.01", label: "Pure mathematics", group: "Natural and formal sciences — Mathematics" },
  { code: "1.01.02", label: "Applied mathematics", group: "Natural and formal sciences — Mathematics" },
  { code: "1.01.03", label: "Statistics and probability", group: "Natural and formal sciences — Mathematics" },
  { code: "1.02.01", label: "Computer sciences", group: "Natural and formal sciences — Computer and information sciences" },
  { code: "1.02.02", label: "Information technology and bioinformatics", group: "Natural and formal sciences — Computer and information sciences" },
  { code: "1.03.01", label: "Atomic, molecular, and chemical physics", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.02", label: "Interaction with radiation", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.03", label: "Magnetic resonances", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.04", label: "Condensed matter physics", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.05", label: "Solid state physics and superconductivity", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.06", label: "Particles and fields physics", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.07", label: "Nuclear physics", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.08", label: "Fluids and plasma physics (including surface physics)", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.09", label: "Optics (including laser optics and quantum optics)", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.10", label: "Acoustics", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.03.11", label: "Astronomy (including astrophysics space science)", group: "Natural and formal sciences — Physical sciences" },
  { code: "1.04.01", label: "Organic chemistry", group: "Natural and formal sciences — Chemical sciences" },
  { code: "1.04.02", label: "Inorganic and nuclear chemistry", group: "Natural and formal sciences — Chemical sciences" },
  { code: "1.04.03", label: "Physical chemistry, polymer science, and plastics", group: "Natural and formal sciences — Chemical sciences" },
  { code: "1.04.04", label: "Electrochemistry (dry cells, batteries, fuel cells, metal corrosion, electrolysis)", group: "Natural and formal sciences — Chemical sciences" },
  { code: "1.04.05", label: "Colloid chemistry", group: "Natural and formal sciences — Chemical sciences" },
  { code: "1.04.06", label: "Analytical chemistry", group: "Natural and formal sciences — Chemical sciences" },
  { code: "1.05.01", label: "Geosciences, multidisciplinary", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.05.02", label: "Mineralogy and palaeontology", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.05.03", label: "Geochemistry and geophysics", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.05.04", label: "Physical geography", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.05.05", label: "Geology and volcanology", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.05.06", label: "Environmental sciences", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.05.07", label: "Meteorology, atmospheric sciences, and climatic research", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.05.08", label: "Oceanography, hydrology, and water resources", group: "Natural and formal sciences — Earth and related environmental sciences" },
  { code: "1.06.01", label: "Cell biology, microbiology, and virology", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.02", label: "Biochemistry, molecular biology, and biochemical research", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.03", label: "Mycology", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.04", label: "Biophysics", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.05", label: "Genetics and heredity (medical genetics under code 3)", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.06", label: "Reproductive biology (medical aspects under code 3)", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.07", label: "Developmental biology", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.08", label: "Plant sciences and botany", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.09", label: "Zoology, ornithology, entomology, and behavioural sciences biology", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.10", label: "Marine biology, freshwater biology, and limnology", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.11", label: "Ecology and biodiversity conservation", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.12", label: "Biology (theoretical, thermal, cryobiology, biological rhythm)", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.06.13", label: "Evolutionary biology", group: "Natural and formal sciences — Biological sciences" },
  { code: "1.07.01", label: "Other natural sciences", group: "Natural and formal sciences — Other natural sciences" },
  { code: "2.01.01", label: "Civil engineering", group: "Engineering and technology — Civil engineering" },
  { code: "2.01.02", label: "Architecture engineering", group: "Engineering and technology — Civil engineering" },
  { code: "2.01.03", label: "Municipal and structural engineering", group: "Engineering and technology — Civil engineering" },
  { code: "2.01.04", label: "Transport engineering", group: "Engineering and technology — Civil engineering" },
  { code: "2.02.01", label: "Electrical and electronic engineering", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.02", label: "Robotics and automatic control", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.03", label: "Micro-electronics", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.04", label: "Semiconductors", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.05", label: "Automation and control systems", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.06", label: "Communication engineering and systems", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.07", label: "Telecommunications", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.08", label: "Computer hardware and architecture", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.02.09", label: "Software engineering and technology", group: "Engineering and technology — Electrical, electronic, and information technology" },
  { code: "2.03.01", label: "Mechanical engineering", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.02", label: "Applied mechanics", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.03", label: "Thermodynamics", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.04", label: "Aerospace engineering", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.05", label: "Nuclear related engineering (nuclear physics under 1.03.07)", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.06", label: "Acoustical engineering", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.07", label: "Reliability analysis and non-destructive testing", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.08", label: "Automotive and transportation engineering and manufacturing", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.09", label: "Tooling, machinery, and equipment engineering and manufacturing", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.03.10", label: "Heating, ventilation, and air conditioning engineering and manufacturing", group: "Engineering and technology — Mechanical engineering" },
  { code: "2.04.01", label: "Chemical engineering (plants, products)", group: "Engineering and technology — Chemical engineering" },
  { code: "2.04.02", label: "Chemical process engineering", group: "Engineering and technology — Chemical engineering" },
  { code: "2.05.01", label: "Materials engineering and metallurgy", group: "Engineering and technology — Materials engineering" },
  { code: "2.05.02", label: "Ceramics", group: "Engineering and technology — Materials engineering" },
  { code: "2.05.03", label: "Coating and films (including packaging and printing)", group: "Engineering and technology — Materials engineering" },
  { code: "2.05.04", label: "Plastics, rubber, and composites (including laminates and reinforced plastics)", group: "Engineering and technology — Materials engineering" },
  { code: "2.05.05", label: "Paper and wood and textiles", group: "Engineering and technology — Materials engineering" },
  { code: "2.05.06", label: "Construction materials (organic and inorganic)", group: "Engineering and technology — Materials engineering" },
  { code: "2.06.01", label: "Medical and biomedical engineering", group: "Engineering and technology — Medical engineering" },
  { code: "2.06.02", label: "Medical laboratory technology (biomaterials under 2.09.05)", group: "Engineering and technology — Medical engineering" },
  { code: "2.07.01", label: "Environmental and geological engineering", group: "Engineering and technology — Environmental engineering" },
  { code: "2.07.02", label: "Petroleum engineering (fuel, oils)", group: "Engineering and technology — Environmental engineering" },
  { code: "2.07.03", label: "Energy and fuels", group: "Engineering and technology — Environmental engineering" },
  { code: "2.07.04", label: "Remote sensing", group: "Engineering and technology — Environmental engineering" },
  { code: "2.07.05", label: "Mining and mineral processing", group: "Engineering and technology — Environmental engineering" },
  { code: "2.07.06", label: "Marine engineering, sea vessels, and ocean engineering", group: "Engineering and technology — Environmental engineering" },
  { code: "2.08.01", label: "Environmental biotechnology", group: "Engineering and technology — Environmental biotechnology" },
  { code: "2.08.02", label: "Bioremediation", group: "Engineering and technology — Environmental biotechnology" },
  { code: "2.08.03", label: "Diagnostic biotechnologies in environmental management (DNA chips and biosensing devices)", group: "Engineering and technology — Environmental biotechnology" },
  { code: "2.09.01", label: "Industrial biotechnology", group: "Engineering and technology — Industrial biotechnology" },
  { code: "2.09.02", label: "Bioprocessing technologies", group: "Engineering and technology — Industrial biotechnology" },
  { code: "2.09.03", label: "Biocatalysis and fermentation", group: "Engineering and technology — Industrial biotechnology" },
  { code: "2.09.04", label: "Bioproducts (products that are manufactured using biological material as feedstock)", group: "Engineering and technology — Industrial biotechnology" },
  { code: "2.09.05", label: "Biomaterials (bioplastics, biofuels, bioderived bulk and fine chemicals, bio-derived materials)", group: "Engineering and technology — Industrial biotechnology" },
  { code: "2.10.01", label: "Nano-materials (production and properties)", group: "Engineering and technology — Nano-technology" },
  { code: "2.10.02", label: "Nano-processes (applications on nano-scale)", group: "Engineering and technology — Nano-technology" },
  { code: "2.11.01", label: "Food and beverages", group: "Engineering and technology — Other engineering and technologies" },
  { code: "2.11.02", label: "Oenology", group: "Engineering and technology — Other engineering and technologies" },
  { code: "2.11.03", label: "Other engineering and technologies", group: "Engineering and technology — Other engineering and technologies" },
  { code: "3.01.01", label: "Anatomy and morphology (plant science under 1.06.08)", group: "Medical and health sciences — Basic medicine" },
  { code: "3.01.02", label: "Human genetics", group: "Medical and health sciences — Basic medicine" },
  { code: "3.01.03", label: "Immunology", group: "Medical and health sciences — Basic medicine" },
  { code: "3.01.04", label: "Neurosciences", group: "Medical and health sciences — Basic medicine" },
  { code: "3.01.05", label: "Pharmacology and pharmacy and medicinal chemistry", group: "Medical and health sciences — Basic medicine" },
  { code: "3.01.06", label: "Toxicology", group: "Medical and health sciences — Basic medicine" },
  { code: "3.01.07", label: "Physiology and cytology", group: "Medical and health sciences — Basic medicine" },
  { code: "3.01.08", label: "Pathology", group: "Medical and health sciences — Basic medicine" },
  { code: "3.02.01", label: "Andrology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.02", label: "Obstetrics and gynaecology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.03", label: "Paediatrics", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.04", label: "Cardiac and cardiovascular systems", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.05", label: "Haematology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.06", label: "Anaesthesiology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.07", label: "Orthopaedics", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.08", label: "Radiology and nuclear medicine", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.09", label: "Dentistry, oral surgery, and medicine", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.10", label: "Dermatology, venereal diseases, and allergy", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.11", label: "Rheumatology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.12", label: "Endocrinology and metabolism and gastroenterology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.13", label: "Urology and nephrology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.02.14", label: "Oncology", group: "Medical and health sciences — Clinical medicine" },
  { code: "3.03.01", label: "Health care sciences and nursing", group: "Medical and health sciences — Health sciences" },
  { code: "3.03.02", label: "Nutrition and dietetics", group: "Medical and health sciences — Health sciences" },
  { code: "3.03.03", label: "Parasitology", group: "Medical and health sciences — Health sciences" },
  { code: "3.03.04", label: "Infectious diseases and epidemiology", group: "Medical and health sciences — Health sciences" },
  { code: "3.03.05", label: "Occupational health", group: "Medical and health sciences — Health sciences" },
  { code: "3.04.01", label: "Health-related biotechnology", group: "Medical and health sciences — Medical biotechnology" },
  { code: "3.04.02", label: "Technologies involving the manipulation of cells, tissues, organs, or the whole organism", group: "Medical and health sciences — Medical biotechnology" },
  { code: "3.04.03", label: "Technologies involving identifying the functioning of DNA, proteins, and enzymes", group: "Medical and health sciences — Medical biotechnology" },
  { code: "3.04.04", label: "Pharmacogenomics, gene-based therapeutics", group: "Medical and health sciences — Medical biotechnology" },
  { code: "3.04.05", label: "Biomaterials (related to medical implants, devices, sensors)", group: "Medical and health sciences — Medical biotechnology" },
  { code: "3.05.01", label: "Forensic science", group: "Medical and health sciences — Other medical sciences" },
  { code: "3.05.02", label: "Other medical sciences", group: "Medical and health sciences — Other medical sciences" },
  { code: "4.01.01", label: "Agriculture", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.01.02", label: "Forestry", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.01.03", label: "Fisheries and aquaculture", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.01.04", label: "Soil science", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.01.05", label: "Horticulture", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.01.06", label: "Viticulture", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.01.07", label: "Agronomy", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.01.08", label: "Plant breeding and plant protection (agricultural biotechnology under 4.04.01)", group: "Agricultural sciences — Agriculture, forestry, and fisheries" },
  { code: "4.02.01", label: "Animal and dairy science", group: "Agricultural sciences — Animal and dairy science" },
  { code: "4.02.02", label: "Animal husbandry (animal biotechnology under 4.04.01)", group: "Agricultural sciences — Animal and dairy science" },
  { code: "4.03.01", label: "Veterinary science (all)", group: "Agricultural sciences — Veterinary science" },
  { code: "4.04.01", label: "Agricultural biotechnology and food biotechnology", group: "Agricultural sciences — Agricultural biotechnology" },
  { code: "4.04.02", label: "Genetically modified (GM) organism technology and livestock cloning", group: "Agricultural sciences — Agricultural biotechnology" },
  { code: "4.04.03", label: "Diagnostics (DNA chips and biosensing devices)", group: "Agricultural sciences — Agricultural biotechnology" },
  { code: "4.04.04", label: "Biomass feedstock production technologies", group: "Agricultural sciences — Agricultural biotechnology" },
  { code: "4.04.05", label: "Biopharming", group: "Agricultural sciences — Agricultural biotechnology" },
  { code: "4.05.01", label: "Other agricultural sciences", group: "Agricultural sciences — Other agricultural sciences" },
] as const satisfies readonly CraScienceCodeEntry[];

export type CraScienceCode = (typeof CRA_SCIENCE_CODES)[number]["code"];

const CRA_SCIENCE_CODE_MEMBERSHIP: Readonly<Record<string, true>> =
  Object.fromEntries(CRA_SCIENCE_CODES.map(({ code }) => [code, true]));

export const CRA_SCIENCE_CODE_ITEMS = [
  { value: "", label: "Not set" },
  ...CRA_SCIENCE_CODES.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` })),
];

export const CRA_SCIENCE_CODE_LABELS: Record<string, string> = Object.fromEntries(
  CRA_SCIENCE_CODES.map((c) => [c.code, `${c.code} — ${c.label}`])
);

export function isCraScienceCode(value: unknown): value is CraScienceCode {
  return typeof value === "string" && CRA_SCIENCE_CODE_MEMBERSHIP[value] === true;
}

export function normalizeCraScienceCode(
  value: string | null | undefined
): CraScienceCode | undefined {
  const normalized = value?.trim();
  return isCraScienceCode(normalized) ? normalized : undefined;
}

export function scienceCodeLabel(code: string | null | undefined): string {
  if (!code) return "Not set";
  return CRA_SCIENCE_CODE_LABELS[code] ?? code;
}
