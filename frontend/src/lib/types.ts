// Shapes returned by the Zyqra API.

export interface User {
  id: number;
  username: string;
  daily_goal_minutes: number;
  created_at: string | null;
  is_admin: boolean;
  /** The administrator defined in backend/.env; its name and password are set there. */
  builtin_admin: boolean;
}

export interface AuthSession {
  token: string;
  user: User;
}

/** Which model produced a response, and whether a better one had to be skipped. */
export interface ModelMeta {
  provider: string;
  model: string;
  label: string;
  fallback: boolean;
}

// ── Chat ────────────────────────────────────────────────────
export interface Chat {
  id: number;
  title: string;
  mode: string;
  pinned: boolean;
  updated_at: string | null;
}

export interface Message {
  id: number;
  role: "user" | "ai";
  content: string;
  model: string | null;
  provider: string | null;
  created_at: string | null;
}

export type StreamEvent =
  | { type: "user_message"; message: Message | null; chat: Chat }
  | ({ type: "meta" } & ModelMeta)
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; message: Message | null };

export interface ChatMode {
  id: string;
  label: string;
  hint: string;
}

export interface Meta {
  version: string;
  chat_modes: ChatMode[];
  note_actions: { id: string; label: string }[];
}

// ── Quiz ────────────────────────────────────────────────────
export type Difficulty = "Easy" | "Medium" | "Hard";

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface AnsweredQuestion extends QuizQuestion {
  user_answer: string;
  is_correct: boolean;
}

export interface QuizSession {
  id: number;
  title: string;
  topic: string;
  difficulty: string;
  score: number;
  total: number;
  duration_seconds: number;
  created_at: string | null;
}

export interface QuizSessionDetail extends QuizSession {
  questions: AnsweredQuestion[];
}

// ── Flashcards ──────────────────────────────────────────────
export type Rating = "again" | "hard" | "good" | "easy";

export interface Card {
  id: number;
  front: string;
  back: string;
  is_new: boolean;
  is_due: boolean;
  due_at: string | null;
  interval_days: number;
  repetitions: number;
  /** Days until the next review if rated hard / good / easy now. */
  next_days: Record<"hard" | "good" | "easy", number>;
}

export interface Deck {
  id: number;
  title: string;
  topic: string;
  card_count: number;
  new_count: number;
  due_count: number;
  created_at: string | null;
}

export interface DeckDetail extends Deck {
  cards: Card[];
}

// ── Notes ───────────────────────────────────────────────────
export interface Note {
  id: number;
  title: string;
  preview: string;
  word_count: number;
  pinned: boolean;
  updated_at: string | null;
}

export interface NoteDetail extends Note {
  content: string;
}

// ── Planner ─────────────────────────────────────────────────
export type Priority = "low" | "medium" | "high";

export interface TaskDraft {
  title: string;
  details: string;
  subject: string;
  priority: Priority;
  due_date: string | null;
}

export interface Task extends TaskDraft {
  id: number;
  done: boolean;
  completed_at: string | null;
  created_at: string | null;
}

// ── Dashboard ───────────────────────────────────────────────
export interface HeatmapDay {
  date: string;
  points: number;
  quizzes?: number;
  reviews?: number;
  focus_minutes?: number;
  messages?: number;
}

export interface TopicStat {
  topic: string;
  count: number;
  accuracy: number;
}

export interface DashboardData {
  streak: { current: number; best: number; active_today: boolean };
  focus: { today_minutes: number; week_minutes: number; total_minutes: number; goal_minutes: number };
  totals: {
    quizzes: number; questions: number; correct: number; accuracy: number;
    decks: number; cards: number; cards_due: number; cards_new: number; reviews: number;
    notes: number; note_words: number; chats: number;
    tasks_open: number; tasks_overdue: number; tasks_done: number;
  };
  heatmap: HeatmapDay[];
  score_trend: { id: number; title: string; accuracy: number; date: string | null }[];
  by_difficulty: Record<Difficulty, { count: number; accuracy: number }>;
  top_topics: TopicStat[];
  weak_topics: TopicStat[];
  upcoming_tasks: Task[];
  recent_quizzes: QuizSession[];
}

// ── AI engine ───────────────────────────────────────────────
/** `blocked`: a paid model held back by free-only mode. */
export type ModelState = "ready" | "cooldown" | "no_key" | "disabled" | "blocked";

/** true = free tier, false = billed, null = the provider doesn't say. */
export type Free = boolean | null;

export interface ChainModel {
  id: string;
  position: number;
  provider: string;
  provider_name: string;
  model: string;
  label: string;
  tier: string;
  free: Free;
  context: number | null;
  state: ModelState;
  reason: string;
  cooldown_until: string | null;
  cooldown_seconds: number;
  listed: boolean | null;
  ok: number;
  failed: number;
  last_used_at: string | null;
  last_latency_ms: number;
  last_error: string;
  last_error_at: string | null;
}

/** How a provider's models are priced: every one free, none, some, or decided per model. */
export type FreeRule = "all" | "none" | "some" | "auto";

export interface ProviderField {
  env: string;
  label: string;
  set?: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  custom: boolean;
  local: boolean;
  requires_key: boolean;
  base_url: string;
  key_env: string;
  configured: boolean;
  key_count: number;
  /** Last characters of the stored key (administrators only). */
  key_hint: string;
  fields: ProviderField[];
  signup_url: string;
  free_tier: string;
  free: FreeRule;
  /** Chat models the provider offers; null until its list has been fetched. */
  model_count: number | null;
  added_count: number;
  error: string;
}

export interface AIStatus {
  active: string | null;
  chain: ChainModel[];
  providers: AIProvider[];
  free_only: boolean;
  /** The viewer is an administrator: may connect providers and edit the default list. */
  can_manage: boolean;
  /** `chain` is the viewer's own list rather than the default one. */
  personal: boolean;
  config_error: string;
  config_file: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  base_url: string;
  signup_url: string;
  free_tier: string;
  free: FreeRule;
  local: boolean;
  requires_key: boolean;
  fields: ProviderField[];
  added: boolean;
}

export interface OfferedModel {
  id: string;
  name: string;
  context: number | null;
  free: Free;
  added: boolean;
}

export interface ProviderModels {
  provider: string;
  models: OfferedModel[];
  error: string;
  fetched_at: string | null;
}

export interface SearchResult {
  type: "chat" | "note" | "deck" | "quiz" | "task";
  id: number;
  title: string;
  snippet: string;
}

// ── Admin ───────────────────────────────────────────────────
export interface AdminUser {
  id: number;
  username: string;
  is_admin: boolean;
  /** The account defined in backend/.env; it can't be changed from the app. */
  builtin: boolean;
  own_models: boolean;
  created_at: string | null;
  last_active_at: string | null;
  chats: number;
  quizzes: number;
  notes: number;
  decks: number;
  focus_minutes: number;
}

export interface AdminOverview {
  registration_open: boolean;
  totals: { users: number; admins: number; chats: number; messages: number; quizzes: number; notes: number; decks: number };
  users: AdminUser[];
}
