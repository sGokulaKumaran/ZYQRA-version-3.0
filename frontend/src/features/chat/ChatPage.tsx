import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { PageProps } from "../../components/layout/AppShell";
import Logo from "../../components/layout/Logo";
import SplitView from "../../components/layout/SplitView";
import { Button, IconButton } from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/Icon";
import Markdown from "../../components/ui/Markdown";
import { Menu, MenuItem, ModelBadge } from "../../components/ui/primitives";
import { useApp } from "../../context/AppContext";
import { useUser } from "../../context/AuthContext";
import { useUI } from "../../context/UIContext";
import { api, errorMessage } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import type { Chat, DeckDetail, Message, ModelMeta, NoteDetail } from "../../lib/types";
import ModelPicker from "./ModelPicker";
import "./chat.css";

const MODE_ICON: Record<string, IconName> = {
  tutor: "cap",
  simple: "idea",
  exam: "target",
  socratic: "quiz",
  coding: "code",
};

const STARTERS: { icon: IconName; title: string; prompt: string }[] = [
  { icon: "idea", title: "Explain a concept", prompt: "Explain how photosynthesis works, step by step, with a simple analogy." },
  { icon: "target", title: "Prepare for an exam", prompt: "I have a calculus exam on derivatives. Give me the key rules and 3 practice problems with solutions." },
  { icon: "code", title: "Debug my code", prompt: "Explain recursion in Python with a small example and the most common mistake beginners make." },
  { icon: "book", title: "Summarise a topic", prompt: "Summarise the causes of World War I in 6 bullet points I can revise from." },
];

const MODEL_KEY = "zyqra_chat_model";

interface Draft {
  text: string;
  meta: ModelMeta | null;
}

export default function ChatPage({ active }: PageProps) {
  const { meta, ai, refreshAI, navigate, intent, takeIntent, openSettings } = useApp();
  const { toast, confirm, prompt } = useUI();
  const user = useUser();

  const [chats, setChats] = useState<Chat[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null); // the answer being streamed
  const [error, setError] = useState("");
  const [newChatMode, setNewChatMode] = useState("tutor");
  const [preferred, setPreferred] = useState<string | null>(() => localStorage.getItem(MODEL_KEY)); // model id, null = automatic
  const [filter, setFilter] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  const current = chats.find((c) => c.id === currentId) ?? null;
  const mode = current?.mode ?? newChatMode;
  const streaming = draft !== null;
  const modes = meta?.chat_modes ?? [];
  const modeLabel = modes.find((m) => m.id === mode)?.label ?? "Tutor";
  const pickable = useMemo(() => (ai?.chain ?? []).filter((m) => m.state === "ready" || m.state === "cooldown"), [ai]);

  const choosePreferred = (id: string | null) => {
    setPreferred(id);
    if (id) localStorage.setItem(MODEL_KEY, id);
    else localStorage.removeItem(MODEL_KEY);
  };

  const loadChats = useCallback(async () => {
    try {
      setChats(await api.get<Chat[]>("/api/chats"));
    } catch (err) {
      toast.error(err);
    }
  }, [toast]);

  useEffect(() => {
    if (active) void loadChats();
  }, [active, loadChats]);

  const openChat = useCallback(async (id: number) => {
    abortRef.current?.abort();
    setCurrentId(id);
    setError("");
    setDraft(null);
    setPanelOpen(false);
    setLoadingChat(true);
    stickToBottom.current = true;
    try {
      setMessages(await api.get<Message[]>(`/api/chats/${id}/messages`));
    } catch (err) {
      toast.error(err);
    }
    setLoadingChat(false);
  }, [toast]);

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setCurrentId(null);
    setMessages([]);
    setError("");
    setDraft(null);
    setPanelOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // ── scrolling ───────────────────────────────────────────────
  useEffect(() => {
    const box = scrollRef.current;
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [messages, draft, error]);

  const onScroll = () => {
    const box = scrollRef.current;
    if (box) stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  };

  // ── asking ──────────────────────────────────────────────────
  const run = useCallback(
    async (chatId: number, body: { content?: string; regenerate?: boolean }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setError("");
      setDraft({ text: "", meta: null });
      stickToBottom.current = true;
      let text = "";
      try {
        await api.stream(
          `/api/chats/${chatId}/stream`,
          { ...body, model: preferred },
          (event) => {
            if (event.type === "user_message") {
              const { message, chat } = event;
              if (message) setMessages((list) => [...list.filter((m) => m.id > 0), message]);
              setChats((list) => [chat, ...list.filter((c) => c.id !== chat.id)].sort((a, b) => Number(b.pinned) - Number(a.pinned)));
            } else if (event.type === "meta") {
              const modelMeta: ModelMeta = { provider: event.provider, model: event.model, label: event.label, fallback: event.fallback };
              setDraft((d) => ({ text: d?.text ?? "", meta: modelMeta }));
            } else if (event.type === "delta") {
              text += event.text;
              setDraft((d) => ({ text, meta: d?.meta ?? null }));
            } else if (event.type === "error") {
              setError(event.message);
            } else if (event.type === "done") {
              const { message } = event;
              if (message) setMessages((list) => [...list, message]);
              setDraft(null); // swap the live draft for the stored message in one render
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          // Stopped by the user: the server keeps what was written so far.
          window.setTimeout(() => {
            api.get<Message[]>(`/api/chats/${chatId}/messages`).then(setMessages).catch(() => {});
          }, 400);
        } else {
          setError(errorMessage(err));
        }
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
        setDraft(null);
      }
      void refreshAI(); // a fallback or cooldown may have changed which model is active
    },
    [preferred, refreshAI],
  );

  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim();
      if (!content || streaming) return;
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      let chatId = currentId;
      try {
        if (chatId === null) {
          const chat = await api.post<Chat>("/api/chats", { mode: newChatMode });
          chatId = chat.id;
          setChats((list) => [chat, ...list]);
          setCurrentId(chat.id);
          setMessages([]);
        }
      } catch (err) {
        toast.error(err);
        setInput(content);
        return;
      }
      // Show the question immediately; the server's copy replaces it.
      setMessages((list) => [...list, { id: -Date.now(), role: "user", content, model: null, provider: null, created_at: null }]);
      await run(chatId, { content });
    },
    [currentId, newChatMode, run, streaming, toast],
  );

  const regenerate = () => {
    if (currentId === null || streaming) return;
    setMessages((list) => (list.length && list[list.length - 1].role === "ai" ? list.slice(0, -1) : list));
    void run(currentId, { regenerate: true });
  };

  const stop = () => abortRef.current?.abort();

  // ── intents from other pages / the command palette ──────────
  useEffect(() => {
    if (!active || !intent) return;
    const next = takeIntent();
    if (next?.chatId) void openChat(next.chatId);
    else if (next?.ask) {
      startNew();
      void send(next.ask);
    }
    // `send`/`startNew` are stable enough here; re-running on their identity would re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intent]);

  // ── chat list actions ───────────────────────────────────────
  const setMode = async (next: string) => {
    if (!current) {
      setNewChatMode(next);
      return;
    }
    try {
      const updated = await api.patch<Chat>(`/api/chats/${current.id}`, { mode: next });
      setChats((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      toast.error(err);
    }
  };

  const renameChat = async (chat: Chat) => {
    const title = await prompt({ title: "Rename chat", label: "Title", initial: chat.title });
    if (!title) return;
    try {
      const updated = await api.patch<Chat>(`/api/chats/${chat.id}`, { title });
      setChats((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      toast.error(err);
    }
  };

  const togglePin = async (chat: Chat) => {
    try {
      await api.patch<Chat>(`/api/chats/${chat.id}`, { pinned: !chat.pinned });
      await loadChats();
    } catch (err) {
      toast.error(err);
    }
  };

  const deleteChat = async (chat: Chat) => {
    const ok = await confirm({
      title: "Delete this chat?",
      message: `“${chat.title}” and all of its messages will be permanently deleted.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/chats/${chat.id}`);
      setChats((list) => list.filter((c) => c.id !== chat.id));
      if (chat.id === currentId) startNew();
    } catch (err) {
      toast.error(err);
    }
  };

  // ── message actions ─────────────────────────────────────────
  const copy = async (message: Message) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const saveToNotes = async (message: Message) => {
    setBusyAction(`note-${message.id}`);
    try {
      const note = await api.post<NoteDetail>("/api/notes", { title: current?.title ?? "From AI tutor", content: message.content });
      toast.success("Saved to Notes.");
      navigate("notes", { noteId: note.id });
    } catch (err) {
      toast.error(err);
    }
    setBusyAction(null);
  };

  const makeFlashcards = async (message: Message) => {
    setBusyAction(`cards-${message.id}`);
    try {
      const deck = await api.post<DeckDetail>("/api/flashcards/generate", {
        topic: current?.title ?? "Chat notes",
        source_text: message.content,
        count: 8,
      });
      toast.success(`${deck.card_count} flashcards created.`);
      navigate("flashcards", { deckId: deck.id });
    } catch (err) {
      toast.error(err);
    }
    setBusyAction(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  const growInput = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const visibleChats = chats.filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const lastMessage = messages[messages.length - 1];
  const noProvider = ai !== null && !ai.providers.some((p) => p.configured);
  const empty = messages.length === 0 && !streaming && !loadingChat;

  const panel = (
    <>
      <div className="panel-head">
        <h2>Chats</h2>
        <Button size="sm" variant="soft" icon="plus" onClick={startNew}>New</Button>
      </div>
      {chats.length > 6 && (
        <div className="panel-tools">
          <div className="input-icon">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Filter chats" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      )}
      <div className="panel-list">
        {chats.length === 0 && <p className="panel-empty">No chats yet.<br />Ask your first question to begin.</p>}
        {visibleChats.map((chat) => (
          <div
            key={chat.id}
            role="button"
            tabIndex={0}
            className={`panel-item ${chat.id === currentId ? "on" : ""}`}
            onClick={() => void openChat(chat.id)}
            onKeyDown={(e) => e.key === "Enter" && void openChat(chat.id)}
          >
            <div className="panel-item-title">
              {chat.pinned && <Icon name="pinTack" size={13} />}
              <span>{chat.title}</span>
            </div>
            <div className="panel-item-meta">
              <Icon name={MODE_ICON[chat.mode] ?? "cap"} size={12} />
              <span>{timeAgo(chat.updated_at) || "Earlier"}</span>
            </div>
            <div className="panel-item-actions" onClick={(e) => e.stopPropagation()}>
              <IconButton size="sm" icon="pinTack" label={chat.pinned ? "Unpin" : "Pin"} active={chat.pinned} onClick={() => void togglePin(chat)} />
              <IconButton size="sm" icon="edit" label="Rename" onClick={() => void renameChat(chat)} />
              <IconButton size="sm" icon="trash" label="Delete" danger onClick={() => void deleteChat(chat)} />
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <SplitView panel={panel} panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)}>
      <div className="page chat">
        <header className="page-head">
          <IconButton className="only-narrow" icon="list" label="Show chats" onClick={() => setPanelOpen(true)} />
          <h1 className="truncate">{current?.title ?? "New chat"}</h1>
          <span className="spacer" />
          <Menu
            align="right"
            trigger={(toggle) => (
              <Button size="sm" variant="secondary" icon={MODE_ICON[mode] ?? "cap"} iconRight="chevronDown" onClick={toggle} title="Study mode">
                {modeLabel}
              </Button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">Study mode</div>
                {modes.map((m) => (
                  <MenuItem
                    key={m.id}
                    icon={MODE_ICON[m.id] ?? "cap"}
                    label={m.label}
                    hint={m.hint}
                    active={m.id === mode}
                    onClick={() => { close(); void setMode(m.id); }}
                  />
                ))}
              </>
            )}
          </Menu>
        </header>

        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="chat-thread">
            {empty && (
              <div className="chat-welcome">
                <Logo size={44} />
                <h2>Hi {user.username}, what are we learning today?</h2>
                <p>Ask anything. Switch the study mode at the top to change how answers are explained.</p>
                <div className="chat-starters">
                  {STARTERS.map((s) => (
                    <button key={s.title} type="button" className="chat-starter" onClick={() => void send(s.prompt)}>
                      <Icon name={s.icon} size={18} />
                      <b>{s.title}</b>
                      <span>{s.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={message.id} className="msg msg-user">
                  <div className="msg-bubble">{message.content}</div>
                </div>
              ) : (
                <div key={message.id} className="msg msg-ai">
                  <div className="msg-avatar"><Logo size={26} /></div>
                  <div className="msg-body">
                    <Markdown>{message.content}</Markdown>
                    <div className="msg-tools">
                      {message.model && <ModelBadge model={{ label: message.model, fallback: false }} />}
                      <IconButton size="sm" icon={copiedId === message.id ? "check" : "copy"} label="Copy answer" onClick={() => void copy(message)} />
                      <IconButton size="sm" icon="note" label="Save to Notes" loading={busyAction === `note-${message.id}`} onClick={() => void saveToNotes(message)} />
                      <IconButton size="sm" icon="cards" label="Make flashcards from this answer" loading={busyAction === `cards-${message.id}`} onClick={() => void makeFlashcards(message)} />
                      {index === messages.length - 1 && !streaming && (
                        <IconButton size="sm" icon="refresh" label="Answer again" onClick={regenerate} />
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}

            {draft && (
              <div className="msg msg-ai">
                <div className="msg-avatar"><Logo size={26} /></div>
                <div className="msg-body">
                  {draft.text ? (
                    <Markdown>{draft.text}</Markdown>
                  ) : (
                    <div className="msg-thinking" aria-label="Thinking"><i /><i /><i /></div>
                  )}
                  {draft.meta && <div className="msg-tools always"><ModelBadge model={draft.meta} /></div>}
                </div>
              </div>
            )}

            {!streaming && !error && !loadingChat && lastMessage?.role === "user" && (
              <div className="notice chat-error">
                <Icon name="info" size={17} />
                <span style={{ flex: 1 }}>This question hasn't been answered yet.</span>
                <Button size="sm" variant="secondary" icon="sparkles" onClick={regenerate}>Answer it</Button>
              </div>
            )}

            {error && (
              <div className="notice danger chat-error" role="alert">
                <Icon name="alertTriangle" size={17} />
                <span style={{ flex: 1 }}>{error}</span>
                {noProvider ? (
                  <Button size="sm" variant="secondary" icon="cpu" onClick={() => openSettings("ai")}>AI settings</Button>
                ) : (
                  lastMessage?.role === "user" && <Button size="sm" variant="secondary" icon="refresh" onClick={regenerate}>Try again</Button>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="chat-composer">
          <div className="composer-box">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder="Ask anything…"
              aria-label="Message"
              onChange={(e) => { setInput(e.target.value); growInput(e.target); }}
              onKeyDown={onKeyDown}
            />
            <div className="composer-bar">
              <ModelPicker
                models={pickable}
                value={preferred}
                onChange={choosePreferred}
                onManage={() => openSettings("ai")}
              />
              <span className="composer-hint"><kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd>+<kbd className="kbd">Enter</kbd> new line</span>
              {streaming ? (
                <button type="button" className="composer-send stop" onClick={stop} aria-label="Stop answering" title="Stop">
                  <Icon name="stop" size={17} />
                </button>
              ) : (
                <button type="button" className="composer-send" onClick={() => void send(input)} disabled={!input.trim()} aria-label="Send" title="Send">
                  <Icon name="send" size={18} />
                </button>
              )}
            </div>
          </div>
          <p className="composer-note">AI answers can contain mistakes — double-check anything important.</p>
        </footer>
      </div>
    </SplitView>
  );
}
