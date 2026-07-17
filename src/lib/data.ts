export type Paper = {
  id: number;
  title: string;
  authors: string;
  journal: string;
  year: number;
  citations: number;
  doi: string;
  tags: string[];
  relevance: number;
  abstract: string;
};

export const PAPERS: Paper[] = [
  {
    id: 1,
    title: "Lipid Nanoparticle Engineering for Tissue-Specific CRISPR-Cas9 Delivery",
    authors: "Okafor, R.; Lindqvist, M.; Sato, H.",
    journal: "Nature Biotechnology",
    year: 2025,
    citations: 412,
    doi: "10.1038/nbt.2025.0342",
    tags: ["CRISPR", "gene therapy", "delivery systems"],
    relevance: 96,
    abstract:
      "We report a modular lipid nanoparticle platform with tunable ionizable lipid ratios that achieves selective editing efficiency above 60% in liver and lung tissue while reducing off-target immune activation compared to AAV vectors.",
  },
  {
    id: 2,
    title: "AAV Capsid Engineering Overcomes Pre-Existing Neutralizing Immunity",
    authors: "Marchetti, F.; Dube, A.",
    journal: "Cell Gene Therapy",
    year: 2024,
    citations: 289,
    doi: "10.1016/j.cgt.2024.1187",
    tags: ["AAV", "immunogenicity", "vector design"],
    relevance: 91,
    abstract:
      "Directed evolution of AAV9 capsid loops yields variants that evade 78% of patient-derived neutralizing antibodies, enabling redosing strategies previously blocked by adaptive immune memory.",
  },
  {
    id: 3,
    title: "Extracellular Vesicles as Endogenous Carriers for Ribonucleoprotein Editors",
    authors: "Chen, Y.; Almeida, P.; Novak, T.",
    journal: "Science Translational Medicine",
    year: 2025,
    citations: 156,
    doi: "10.1126/scitranslmed.2025.4471",
    tags: ["exosomes", "RNP delivery", "CRISPR"],
    relevance: 88,
    abstract:
      "Engineered exosomes loaded with Cas9 ribonucleoprotein complexes show transient editing windows that minimize genotoxicity, tested across three in vivo models with favorable biodistribution.",
  },
  {
    id: 4,
    title: "Base Editing Efficiency Across Chromatin Accessibility States",
    authors: "Petrov, I.; Owusu, K.",
    journal: "Molecular Cell",
    year: 2023,
    citations: 601,
    doi: "10.1016/j.molcel.2023.0098",
    tags: ["base editing", "chromatin", "genomics"],
    relevance: 74,
    abstract:
      "Editing efficiency correlates strongly with local chromatin accessibility rather than sequence context alone, suggesting pre-screening loci with ATAC-seq improves clinical editor design.",
  },
  {
    id: 5,
    title: "Long-Term Off-Target Surveillance in Non-Human Primates After In Vivo Editing",
    authors: "Reyes, D.; Fujimoto, S.; Larsen, B.",
    journal: "Nature Medicine",
    year: 2024,
    citations: 233,
    doi: "10.1038/nm.2024.0771",
    tags: ["safety", "off-target", "primate model"],
    relevance: 69,
    abstract:
      "Whole-genome sequencing of edited primates at 18 months post-treatment finds no clonal expansion of off-target variants, supporting long-term safety of dual-guide editing strategies.",
  },
  {
    id: 6,
    title: "Polymer-Peptide Conjugates for Blood-Brain-Barrier-Crossing Gene Editors",
    authors: "Haddad, N.; Kowalski, J.",
    journal: "Advanced Materials",
    year: 2025,
    citations: 84,
    doi: "10.1002/adma.2025.1220",
    tags: ["BBB delivery", "polymer conjugate", "CNS"],
    relevance: 65,
    abstract:
      "A brain-shuttle peptide conjugated to a biodegradable polymer core carries editing payloads across an intact blood-brain barrier in mouse models, opening a route to CNS-targeted therapies.",
  },
  {
    id: 7,
    title: "Single-Cell Atlas of Hepatocyte Response to Ionizable Lipid Exposure",
    authors: "Tanaka, R.; Silva, M.",
    journal: "Cell Reports",
    year: 2022,
    citations: 178,
    doi: "10.1016/j.celrep.2022.1355",
    tags: ["single-cell", "liver", "lipid nanoparticles"],
    relevance: 58,
    abstract:
      "scRNA-seq of hepatocytes exposed to varying ionizable lipid formulations reveals dose-dependent stress signatures, informing safer LNP design for repeat dosing regimens.",
  },
  {
    id: 8,
    title: "Mini-Cas Orthologs Enable Compact All-In-One AAV Editing Constructs",
    authors: "Bergström, E.; Adeyemi, T.",
    journal: "Nature",
    year: 2023,
    citations: 512,
    doi: "10.1038/s41586-023-05902-1",
    tags: ["Cas variants", "AAV packaging", "genome editing"],
    relevance: 54,
    abstract:
      "Newly identified compact Cas orthologs fit guide RNA and editor within a single AAV payload limit, removing the need for split-intein reconstitution strategies.",
  },
];

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: number[];
};

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    content:
      "What are the most promising approaches for targeted CRISPR delivery in vivo right now?",
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "Three delivery strategies currently show the strongest translational momentum. Engineered lipid nanoparticles with tunable ionizable lipid ratios are achieving tissue-selective editing above 60% while cutting off-target immune activation relative to viral vectors [1]. Where repeat dosing matters, evolved AAV capsids that dodge pre-existing neutralizing antibodies are unlocking redosing that was previously blocked by adaptive immunity [2]. A third, earlier-stage direction uses engineered exosomes to shuttle Cas9 ribonucleoprotein complexes directly, giving a transient editing window that limits genotoxicity risk [3].\n\nFor CNS applications specifically, polymer-peptide conjugates that shuttle payloads across the blood-brain barrier are a newer but promising route [6]. If durability and long-term safety are the priority, primate surveillance data at 18 months post-treatment found no clonal off-target expansion with dual-guide strategies [5], which is reassuring for LNP and AAV approaches alike.",
    citations: [1, 2, 3, 6, 5],
  },
];

export const STAT_PAPERS_INDEXED = "20,014,382";
