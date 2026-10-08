// Shapes returned by the Zyqra API.

export interface User {
  id: number;
  username: string;
  daily_goal_minutes: number;
  created_at: string | null;
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
export type ModelState = "ready" | "cooldown" | "no_key" | "disabled";

export interface ChainModel {
  id: string;
  position: number;
  provider: string;
  provider_name: string;
  model: string;
  label: string;
  tier: string;
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

export interface AIProvider {
  id: string;
  name: string;
  key_env: string;
  configured: boolean;
  key_count: number;
  signup_url: string;
  free_tier: string;
  available_models: string[] | null;
}

export interface AIStatus {
  active: string | null;
  chain: ChainModel[];
  providers: AIProvider[];
  config_error: string;
  config_file: string;
}

export interface SearchResult {
  type: "chat" | "note" | "deck" | "quiz" | "task";
  id: number;
  title: string;
  snippet: string;
}
