import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// When deployed externally (Render.com, Railway, etc.) the API lives on a
// different origin. Set VITE_API_URL at build time to the full API service URL
// e.g. https://nutterx-api.onrender.com
// Leave unset when the frontend and API share the same domain/proxy (Replit, etc.)
const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
if (apiUrl) setBaseUrl(apiUrl);

createRoot(document.getElementById("root")!).render(<App />);
