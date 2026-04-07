import ReactMarkdown from "react-markdown";
import { useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Quiz from "./Quiz";
import Flashcards from "./Flashcards";
import Notes from "./Notes";

type Message = {
  role: "user" | "ai";
  text: string;
};

type SidebarTab = "chat" | "quiz" | "flash" | "notes" | "dashboard";

export default function Chat({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [currentChat, setCurrentChat] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("chat");
  const [openSettings, setOpenSettings] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  // ─── Close settings on outside click ─────────────────
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setOpenSettings(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ─── Load chats ───────────────────────────────────────
  useEffect(() => {
    fetch("http://127.0.0.1:8000/get_chats/1")
      .then((res) => res.json())
      .then((data) => setChats(data))
      .catch(() => {});
  }, []);

  // ─── Load messages when chat changes ─────────────────
  useEffect(() => {
    if (!currentChat) return;
    fetch(`http://127.0.0.1:8000/get_messages/${currentChat}`)
      .then((res) => res.json())
      .then((data) => setMessages(data))
      .catch(() => {});
  }, [currentChat]);

  // ─── Auto scroll ──────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Create chat ──────────────────────────────────────
  const createChat = async () => {
    if (currentChat && messages.length === 0) return;
    try {
      const res = await fetch("http://127.0.0.1:8000/create_chat?user_id=1", { method: "POST" });
      const data = await res.json();
      setCurrentChat(data.chat_id);
      setMessages([]);
      const updated = await fetch("http://127.0.0.1:8000/get_chats/1");
      setChats(await updated.json());
    } catch {}
  };

  // ─── Delete chat ──────────────────────────────────────
  const deleteChat = async (chatId: number) => {
    await fetch(`http://127.0.0.1:8000/delete_chat/${chatId}`, { method: "DELETE" });
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (currentChat === chatId) { setCurrentChat(null); setMessages([]); }
  };

  // ─── Rename chat ──────────────────────────────────────
  const renameChat = async (chatId: number) => {
    const newName = prompt("Enter new name");
    if (!newName) return;
    await fetch(`http://127.0.0.1:8000/rename_chat/${chatId}?title=${encodeURIComponent(newName)}`, { method: "PUT" });
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: newName } : c)));
  };

  // ─── Send message ─────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || !currentChat) return;
    const userMsg: Message = { role: "user", text: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.text, chat_id: currentChat }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "ai", text: data.reply || "Error getting response." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "ai", text: "Server error. Please check the backend." }]);
    }
    setLoading(false);
  };

  // ─── Sidebar nav items ────────────────────────────────
  const NAV_ITEMS: { name: string; id: SidebarTab; icon: string }[] = [
    { name: "Chat",       id: "chat",      icon: "💬" },
    { name: "Quiz",       id: "quiz",      icon: "🧪" },
    { name: "Flashcards", id: "flash",     icon: "🃏" },
    { name: "Notes",      id: "notes",     icon: "📝" },
    { name: "Dashboard",  id: "dashboard", icon: "📊" },
  ];

  // ─── Render ───────────────────────────────────────────
  return (
    <div className="flex h-screen bg-[#0f172a] text-white overflow-hidden">

      {/* ═══════════ SIDEBAR ═══════════ */}
      <div className="w-64 bg-[#020617] p-4 flex flex-col h-full flex-shrink-0">

        {/* Top */}
        <div>
          <h1 className="text-xl font-bold mb-5">Zyqra 🚀</h1>
          {activeTab === "chat" && (
            <button onClick={createChat} className="w-full bg-gray-700 p-2 rounded mb-2 hover:bg-gray-600 text-sm font-medium transition-colors">
              + New Chat
            </button>
          )}
        </div>

        {/* Nav */}
        <div className="flex flex-col gap-1 mt-2">
          <div className="border-t border-gray-800 mb-2" />
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all text-left w-full border-0 ${
                activeTab === item.id
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white bg-transparent"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-sm font-medium">{item.name}</span>
            </button>
          ))}
        </div>

        {/* Chat list — only shown on chat tab */}
        {activeTab === "chat" && (
          <div className="flex-1 overflow-hidden flex flex-col mt-4">
            <div className="mb-2 px-1 text-xs text-gray-500 uppercase tracking-wider">Recent</div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition ${
                    currentChat === chat.id ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  <span onClick={() => setCurrentChat(chat.id)} className="truncate flex-1 text-sm">{chat.title}</span>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition ml-1">
                    <button onClick={(e) => { e.stopPropagation(); renameChat(chat.id); }} className="hover:text-yellow-400 text-xs" title="Rename">✏</button>
                    <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} className="hover:text-red-400 text-xs" title="Delete">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab !== "chat" && <div className="flex-1" />}

        {/* Settings */}
        <div className="relative mt-2">
          <button onClick={() => setOpenSettings(!openSettings)} className="w-full bg-gray-800 p-2 rounded hover:bg-gray-700 text-sm transition-colors">
            ⚙️ Settings
          </button>
          {openSettings && (
            <div ref={settingsRef} className="absolute bottom-12 left-0 w-full bg-[#1e293b] p-4 rounded-xl shadow-lg border border-gray-700 z-10">
              <h2 className="text-base font-semibold mb-3">Account</h2>
              <p className="text-xs text-gray-400 mb-1">Username</p>
              <p className="bg-gray-800 p-2 rounded mb-3 text-sm">{localStorage.getItem("username")}</p>
              <button onClick={onLogout} className="w-full bg-red-600 p-2 rounded hover:bg-red-700 text-sm transition-colors">Logout</button>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ MAIN CONTENT ═══════════ */}
      <div className="flex flex-col flex-1 h-screen overflow-hidden">

        {/* ── CHAT TAB ── */}
        {activeTab === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto p-6 flex justify-center">
              <div className="w-full max-w-3xl space-y-6">
                {messages.length === 0 && currentChat && (
                  <div className="flex flex-col items-center justify-center h-full pt-24 text-center">
                    <div className="text-4xl mb-4">💬</div>
                    <p className="text-gray-400 text-sm">Start the conversation by typing below.</p>
                  </div>
                )}
                {!currentChat && (
                  <div className="flex flex-col items-center justify-center h-full pt-24 text-center">
                    <div className="text-5xl mb-4">🚀</div>
                    <h2 className="text-xl font-semibold text-gray-300 mb-2">Welcome to Zyqra</h2>
                    <p className="text-gray-500 text-sm mb-4">Create a new chat to get started.</p>
                    <button onClick={createChat} className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-lg text-sm font-semibold transition-colors">+ New Chat</button>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`p-4 rounded-2xl ${msg.role === "user" ? "bg-blue-600 max-w-md" : "bg-[#1e293b] max-w-2xl"}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{
                          h1: ({ children }) => <h1 className="text-2xl font-bold mb-3">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-xl font-semibold mb-2">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-lg font-semibold mb-2">{children}</h3>,
                          p: ({ children }) => <p className="mb-3 leading-relaxed text-gray-200">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc ml-6 mb-3 space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal ml-6 mb-3 space-y-1">{children}</ol>,
                          code({ inline, children }: any) {
                            return inline
                              ? <code className="bg-gray-800 px-1 rounded text-blue-300">{children}</code>
                              : <pre className="bg-black p-3 rounded-lg overflow-x-auto text-sm mb-3"><code>{children}</code></pre>;
                          },
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
                {loading && <div className="text-center text-gray-400 animate-pulse text-sm">Thinking...</div>}
                <div ref={endRef} />
              </div>
            </div>
            <div className="p-4 border-t border-gray-700 bg-[#0f172a] flex justify-center">
              <div className="w-full max-w-3xl flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (textareaRef.current) {
                      textareaRef.current.style.height = "auto";
                      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
                    }
                  }}
                  rows={1}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  disabled={!currentChat}
                  className="flex-1 p-3 rounded-lg bg-[#1e293b] outline-none resize-none overflow-y-auto max-h-40 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder={currentChat ? "Ask anything..." : "Create a chat to start..."}
                />
                <button
                  onClick={sendMessage}
                  disabled={!currentChat || !input.trim()}
                  className="bg-blue-600 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold text-sm"
                >Send</button>
              </div>
            </div>
          </>
        )}

        {/* ── QUIZ TAB ── */}
        {activeTab === "quiz" && (
          <div className="flex-1 overflow-hidden">
            <Quiz />
          </div>
        )}

        {/* ── FLASHCARDS TAB ── */}
        {activeTab === "flash" && (
          <div className="flex-1 overflow-hidden">
            <Flashcards />
          </div>
        )}

        {/* ── NOTES TAB ── */}
        {activeTab === "notes" && (
          <div className="flex-1 overflow-hidden">
            <Notes />
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === "dashboard" && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="text-5xl">📊</div>
            <h2 className="text-xl font-semibold text-gray-300">Dashboard</h2>
            <p className="text-gray-500 text-sm">Coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
}