import type { CvDocument } from './types';
import { stripAccents } from './text';

// Coincidencia CV-oferta por palabras clave, al estilo del "match score" de Jobright.
// Es deliberadamente simple (sin embeddings) para que corra en la extensión sin costo.

type SkillDef = [name: string, aliases: string[]];

const SKILLS: SkillDef[] = [
  // Lenguajes
  ['JavaScript', ['javascript', 'js', 'ecmascript']],
  ['TypeScript', ['typescript']],
  ['Python', ['python']],
  ['Java', ['java']],
  ['C#', ['c#', 'csharp']],
  ['.NET', ['.net', 'dotnet', 'asp.net']],
  ['C++', ['c++', 'cpp']],
  ['Go', ['golang']],
  ['Ruby', ['ruby']],
  ['Ruby on Rails', ['rails', 'ruby on rails']],
  ['PHP', ['php']],
  ['Laravel', ['laravel']],
  ['Kotlin', ['kotlin']],
  ['Swift', ['swift']],
  ['Scala', ['scala']],
  ['Rust', ['rust']],
  ['SQL', ['sql']],
  // Bases de datos
  ['PostgreSQL', ['postgres', 'postgresql']],
  ['MySQL', ['mysql']],
  ['MongoDB', ['mongo', 'mongodb']],
  ['Redis', ['redis']],
  ['Elasticsearch', ['elasticsearch', 'elastic search']],
  // Frontend
  ['React', ['react', 'react.js', 'reactjs']],
  ['React Native', ['react native']],
  ['Angular', ['angular']],
  ['Vue', ['vue', 'vue.js', 'vuejs']],
  ['Next.js', ['next.js', 'nextjs']],
  ['Svelte', ['svelte']],
  ['HTML', ['html', 'html5']],
  ['CSS', ['css', 'css3', 'sass', 'scss']],
  ['Tailwind', ['tailwind', 'tailwindcss']],
  ['Redux', ['redux']],
  ['GraphQL', ['graphql']],
  ['APIs REST', ['restful', 'api rest', 'apis rest', 'rest api', 'rest apis']],
  // Backend
  ['Node.js', ['node', 'node.js', 'nodejs']],
  ['Express', ['express.js', 'expressjs']],
  ['NestJS', ['nestjs', 'nest.js']],
  ['Django', ['django']],
  ['Flask', ['flask']],
  ['FastAPI', ['fastapi']],
  ['Spring', ['spring', 'spring boot']],
  ['Microservicios', ['microservices', 'microservicios', 'microsservicos']],
  // Cloud / DevOps
  ['AWS', ['aws', 'amazon web services']],
  ['GCP', ['gcp', 'google cloud']],
  ['Azure', ['azure']],
  ['Docker', ['docker']],
  ['Kubernetes', ['kubernetes', 'k8s']],
  ['Terraform', ['terraform']],
  ['CI/CD', ['ci/cd', 'ci cd', 'github actions', 'jenkins', 'gitlab ci', 'continuous integration', 'integracion continua']],
  ['Linux', ['linux']],
  ['Git', ['git']],
  // Datos e IA
  ['Pandas', ['pandas']],
  ['NumPy', ['numpy']],
  ['Spark', ['spark', 'pyspark']],
  ['Airflow', ['airflow']],
  ['dbt', ['dbt']],
  ['Snowflake', ['snowflake']],
  ['BigQuery', ['bigquery']],
  ['Power BI', ['power bi', 'powerbi']],
  ['Tableau', ['tableau']],
  ['Looker', ['looker']],
  ['Excel', ['excel']],
  ['ETL', ['etl', 'elt']],
  ['Machine Learning', ['machine learning', 'aprendizaje automatico', 'ml']],
  ['Deep Learning', ['deep learning']],
  ['TensorFlow', ['tensorflow']],
  ['PyTorch', ['pytorch']],
  ['IA generativa', ['llm', 'llms', 'genai', 'ia generativa', 'generative ai', 'gen ai']],
  ['Análisis de datos', ['analisis de datos', 'data analysis', 'data analytics', 'analise de dados']],
  ['Estadística', ['estadistica', 'statistics', 'estatistica']],
  // Testing / mobile / diseño
  ['Jest', ['jest']],
  ['Cypress', ['cypress']],
  ['Playwright', ['playwright']],
  ['Selenium', ['selenium']],
  ['QA', ['qa', 'quality assurance', 'testing automatizado', 'test automation']],
  ['Android', ['android']],
  ['iOS', ['ios']],
  ['Flutter', ['flutter']],
  ['Figma', ['figma']],
  ['UX/UI', ['ux', 'ui', 'ux/ui', 'ui/ux', 'user experience', 'experiencia de usuario']],
  ['Photoshop', ['photoshop']],
  ['Illustrator', ['illustrator']],
  // Gestión y negocio
  ['Scrum', ['scrum']],
  ['Metodologías ágiles', ['agile', 'agil', 'agiles', 'metodologias ageis']],
  ['Jira', ['jira']],
  ['Kanban', ['kanban']],
  ['Product Management', ['product manager', 'product management', 'gestion de producto', 'product owner']],
  ['Salesforce', ['salesforce']],
  ['SAP', ['sap']],
  ['HubSpot', ['hubspot']],
  ['CRM', ['crm']],
  ['ERP', ['erp']],
  ['Google Analytics', ['google analytics']],
  ['SEO', ['seo']],
  ['SEM', ['sem']],
  ['Google Ads', ['google ads', 'adwords']],
  ['Marketing digital', ['marketing digital', 'digital marketing']],
  ['Redes sociales', ['redes sociales', 'social media', 'midias sociais']],
  ['Ventas', ['ventas', 'sales', 'vendas']],
  ['Atención al cliente', ['atencion al cliente', 'customer service', 'customer success', 'atendimento ao cliente']],
  ['Finanzas', ['finanzas', 'finance', 'financas']],
  ['Contabilidad', ['contabilidad', 'accounting', 'contabilidade']],
  ['Recursos humanos', ['recursos humanos', 'human resources', 'rrhh']],
  ['Logística', ['logistica', 'logistics', 'supply chain', 'cadena de suministro']],
  ['Negociación', ['negociacion', 'negotiation', 'negociacao']],
  ['Liderazgo', ['liderazgo', 'leadership', 'lideranca', 'team lead', 'gestion de equipos']],
  // Idiomas
  ['Inglés', ['ingles', 'english']],
  ['Portugués', ['portugues', 'portuguese']],
];

const STOPWORDS = new Set(
  (
    // español
    'para como con por los las del una uno unos unas que sus este esta estos estas ser son muy mas pero sin sobre entre desde hasta donde cuando cual quien todo toda todos todas tambien nuestro nuestra nuestros nuestras puede pueden tiene tienen hacer parte cada otro otra otros otras bien solo ante bajo contra durante mediante segun tras vos usted ustedes ellos ellas nosotros esto eso aquello ' +
    // inglés
    'the and for with you your our are this that from have will can all who what when where which their they them into about more than such also other must should would could been being were was has had not but any each well able across within ' +
    // portugués
    'com uma umas uns nos nas pelo pela pelos pelas seu sua seus suas voce voces nosso nossa sobre entre tambem ser sao estar mais muito ' +
    // genéricas de avisos de empleo
    'experiencia experience experiencias trabajo trabajar work working equipo equipos team teams empresa company companies buscamos looking requisitos requirements responsabilidades responsibilities conocimientos knowledge years anos puesto position role rol candidato candidata candidate beneficios benefits oportunidad opportunity desarrollo development nivel level areas area clientes cliente client clients proyectos proyecto project projects habilidades skills manejo ofrecemos offer excluyente deseable plus junior senior semi ssr sr jr remoto remote hibrido hybrid tiempo full time jornada'
  ).split(' '),
);

export interface MatchResult {
  /** 0-100, o null si la oferta no tiene palabras clave reconocibles. */
  score: number | null;
  matched: string[];
  missing: string[];
}

function prepare(text: string): string {
  return ` ${stripAccents(text).toLowerCase()} `;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALIAS_REGEX = new Map<string, RegExp>();
function aliasRegex(alias: string): RegExp {
  let re = ALIAS_REGEX.get(alias);
  if (!re) {
    // El "." antes evita que "js" matchee dentro de "node.js".
    re = new RegExp(`(?<![\\p{L}\\p{N}.])${escapeRegex(alias)}(?![\\p{L}\\p{N}+#])`, 'u');
    ALIAS_REGEX.set(alias, re);
  }
  return re;
}

function skillsIn(prepared: string): string[] {
  return SKILLS.filter(([, aliases]) => aliases.some((a) => aliasRegex(a).test(prepared))).map(([name]) => name);
}

function frequentTerms(prepared: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const word of prepared.match(/\p{L}{5,}/gu) ?? []) {
    if (!STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

/** Palabras clave de una oferta: habilidades conocidas y, si son pocas, términos frecuentes. */
export function jobKeywords(jobText: string): { skills: string[]; terms: string[] } {
  const prepared = prepare(jobText);
  const skills = skillsIn(prepared);
  const terms = skills.length < 4 ? frequentTerms(prepared, 8) : [];
  return { skills, terms };
}

export function matchCvToJob(cvText: string, jobText: string): MatchResult {
  const { skills, terms } = jobKeywords(jobText);
  if (skills.length + terms.length === 0) return { score: null, matched: [], missing: [] };

  const cvSkills = new Set(skillsIn(prepare(cvText)));
  const cvPrepared = prepare(cvText);
  const matched: string[] = [];
  const missing: string[] = [];
  let got = 0;
  let total = 0;
  for (const skill of skills) {
    total += 2;
    if (cvSkills.has(skill)) {
      got += 2;
      matched.push(skill);
    } else missing.push(skill);
  }
  for (const term of terms) {
    total += 1;
    if (aliasRegex(term).test(cvPrepared)) {
      got += 1;
      matched.push(term);
    } else missing.push(term);
  }
  return { score: Math.round((got / total) * 100), matched, missing };
}

/** CVs ordenados del que mejor coincide al que peor. */
export function rankCvs(cvs: CvDocument[], jobText: string): Array<{ cv: CvDocument; match: MatchResult }> {
  return cvs
    .map((cv) => ({ cv, match: matchCvToJob(cv.text, jobText) }))
    .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1));
}
