// ─── Login.tsx  ──────────────────────────────────────────────
// REQUIRED CHANGE: onLogin must now accept the username string
// so App.tsx can store it in localStorage for the Settings modal.
//
// Change your Login component's prop type from:
//   { onLogin: () => void }
// to:
//   { onLogin: (username: string) => void }
//
// And call it after a successful login response, e.g.:
//
//   const res = await fetch(`${API}/login`, { ... });
//   const data = await res.json();
//   if (data.status === "success") {
//     onLogin(data.username);   // ← pass the username here
//   }
//
// The username is returned by your FastAPI /login endpoint as:
//   return {"status": "success", "username": existing.username}
// so data.username is already available — just forward it.
