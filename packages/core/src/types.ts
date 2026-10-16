// Contratos compartidos entre la extensión, la futura web y los agentes
// que trabajan en paralelo (ver AGENTS.md). Cambios solo aditivos:
// campos nuevos opcionales, nunca renombrar ni borrar.

/** Oferta de trabajo normalizada. */
export interface JobPosting {
  url: string;
  title: string;
  company: string;
  location?: string;
  employmentType?: string;
  /** Descripción en texto plano (sin HTML). */
  description: string;
  /** Quién la extrajo: "jsonld", "greenhouse", "lever", "generic", "workday", ... */
  source: string;
  extractedAt: number;
}

/** Datos que la persona carga una vez en Opciones. Todo opcional. */
export interface CandidateProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  currentTitle?: string;
  currentCompany?: string;
  yearsOfExperience?: string;
  salaryExpectation?: string;
  noticePeriod?: string;
  workAuthorization?: string;
  /** Notas libres para la IA: qué buscás, preferencias, tono. */
  notes?: string;
}

export type ProfileKey = keyof CandidateProfile;

/** Valores derivados del perfil que no se guardan tal cual. */
export type DerivedProfileKey = 'fullName' | 'location';

export interface CvDocument {
  id: string;
  /** Nombre visible, ej. "CV Frontend". */
  name: string;
  fileName: string;
  mimeType: string;
  /** Texto extraído del archivo. Es lo que se le manda a la IA. */
  text: string;
  /** Archivo original en base64, para adjuntarlo en inputs type=file. */
  dataBase64?: string;
  addedAt: number;
}

export type FieldControl = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file';

export interface FieldOption {
  value: string;
  label: string;
}

/** Un campo de formulario detectado en la página (sin referencias al DOM). */
export interface FormFieldDescriptor {
  /** Id estable entre escaneos de la misma página (hash de nombre/etiqueta). */
  id: string;
  control: FieldControl;
  /** type del input original (email, tel, url, ...). */
  inputType?: string;
  label: string;
  name?: string;
  htmlId?: string;
  autocomplete?: string;
  placeholder?: string;
  required: boolean;
  maxLength?: number;
  options?: FieldOption[];
  currentValue?: string;
}

/** Pregunta que se le manda a la IA. */
export interface QuestionForAi {
  id: string;
  question: string;
  control: FieldControl;
  required: boolean;
  maxLength?: number;
  /** Si viene, la respuesta tiene que ser exactamente una de estas. */
  options?: string[];
}

export interface AiAnswer {
  id: string;
  answer: string;
  /** La IA no tenía datos suficientes: la persona tiene que revisarla. */
  needsReview?: boolean;
}

export interface ChatPrompt {
  system: string;
  user: string;
}

/** Cualquier cosa que pueda responder un prompt: API gratis, Codex local, etc. */
export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string>;
}

export type ProviderPresetId = 'groq' | 'openrouter' | 'gemini' | 'openai' | 'custom';

/** Configuración de una API compatible con OpenAI (se guarda en Opciones). */
export interface ProviderConfig {
  id: string;
  preset: ProviderPresetId;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  /** Pide response_format json_object. Si el modelo no lo soporta se reintenta sin. */
  jsonMode: boolean;
}
