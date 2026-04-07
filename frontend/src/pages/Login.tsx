import { useEffect, useState } from "react";

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setUsername("");
    setPassword("");
  }, []);

  const handleSubmit = async () => {
    if (!username || !password) {
      setMessage("Please fill all fields");
      return;
    }

    setLoading(true);
    setMessage("");

    const url = isLogin ? "login" : "signup";

    try {
      const res = await fetch(`http://127.0.0.1:8000/${url}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username,
          password: password,
        }),
      });

      const data = await res.json();

      console.log("Response:", data); // 🔥 debug

      if (data.status === "success") {
        setStatus("success");
        setMessage(data.message);
        setUsername(""); // 🔥 clear
        setPassword(""); // 🔥 clear
        onLogin(); // Call the onLogin callback to update parent state
      } else {
        setStatus("error");
        setMessage(data.message || "Error");
      }
    } catch (error) {
      console.error(error);
      setMessage("Server error ❌");
    }

    setLoading(false);
  };

  return (
    <div className="h-screen w-full flex bg-[#0f172a] text-white">
      {/* LEFT SIDE */}
      <div className="hidden md:flex w-1/2 flex-col justify-center items-center bg-gradient-to-br from-blue-600 to-purple-700 p-10">
        <h1 className="text-4xl font-bold mb-4">Zyqra 🚀</h1>
        <p className="text-lg text-center opacity-90">
          AI-powered smart learning platform
          <br /> Learn. Practice. Improve.
        </p>
      </div>

      {/* RIGHT SIDE */}
      <div className="w-full md:w-1/2 flex items-center justify-center">
        <div className="w-[380px] p-8 rounded-2xl bg-[#1e293b] shadow-xl space-y-6">
          {/* Title */}
          <h2 className="text-2xl font-bold text-center">
            {isLogin ? "Login to Zyqra" : "Create Account"}
          </h2>

          {/* Inputs */}
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full p-3 rounded-lg bg-[#334155] outline-none focus:ring-2 focus:ring-blue-500"
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 rounded-lg bg-[#334155] outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Button */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full p-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition flex justify-center items-center"
          >
            {loading ? "Please wait..." : isLogin ? "Login" : "Sign Up"}
          </button>

          {/* Message */}
          {message && (
            <p
              className={`text-center text-sm ${
                status === "success" ? "text-green-400" : "text-red-400"
              }`}
            >
              {message}
            </p>
          )}

          {/* Toggle */}
          <p className="text-center text-sm text-gray-400">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <span
              onClick={() => {
                setIsLogin(!isLogin);
                setMessage("");
                setUsername("");
                setPassword("");
              }}
              className="ml-2 text-blue-400 cursor-pointer"
            >
              {isLogin ? "Sign Up" : "Login"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
