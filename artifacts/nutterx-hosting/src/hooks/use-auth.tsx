import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetMe, 
  login as apiLogin, 
  signup as apiSignup, 
  logout as apiLogout,
  AuthRequest,
  getGetMeQueryKey
} from "@workspace/api-client-react";
import type { UserProfile } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (data: AuthRequest) => Promise<void>;
  signup: (data: AuthRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Extend custom fetch to use our auth token
const getToken = () => localStorage.getItem("access_token");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getToken());
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Patch native fetch: inject token + auto-refresh on 401
  useEffect(() => {
    const originalFetch = window.fetch;
    let isRefreshing = false;

    const addToken = (init: RequestInit | undefined, token: string): RequestInit => {
      const patched = { ...(init ?? {}) };
      const headers = new Headers(patched.headers as HeadersInit | undefined);
      headers.set("Authorization", `Bearer ${token}`);
      patched.headers = headers;
      return patched;
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const isApiCall = typeof input === "string" && input.startsWith("/api/");
      const isRefreshCall = typeof input === "string" && input === "/api/auth/refresh";

      const currentToken = localStorage.getItem("access_token");
      if (currentToken && isApiCall) {
        init = addToken(init, currentToken);
      }

      const response = await originalFetch(input, init);

      // Auto-refresh on 401 (but not for the refresh call itself or SSE streams)
      if (
        response.status === 401 &&
        isApiCall &&
        !isRefreshCall &&
        !isRefreshing
      ) {
        const refreshToken = localStorage.getItem("refresh_token");
        if (refreshToken) {
          isRefreshing = true;
          try {
            const refreshRes = await originalFetch("/api/auth/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken }),
            });
            if (refreshRes.ok) {
              const data = await refreshRes.json() as { accessToken: string; refreshToken: string };
              localStorage.setItem("access_token", data.accessToken);
              localStorage.setItem("refresh_token", data.refreshToken);
              setToken(data.accessToken);
              // Retry the original request with the new token
              return originalFetch(input, addToken(init, data.accessToken));
            } else {
              // Refresh failed — clear tokens (user must log in again)
              localStorage.removeItem("access_token");
              localStorage.removeItem("refresh_token");
              setToken(null);
            }
          } catch {
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
            setToken(null);
          } finally {
            isRefreshing = false;
          }
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
    }
  });

  useEffect(() => {
    if (error) {
      // Access token is invalid — clear it so the query stops firing.
      // Do NOT clear the refresh token here; the fetch interceptor may still
      // be able to exchange it for a new access token transparently.
      localStorage.removeItem("access_token");
      setToken(null);
    }
  }, [error]);

  const handleLogin = async (data: AuthRequest) => {
    try {
      const res = await apiLogin(data);
      localStorage.setItem("access_token", res.accessToken);
      localStorage.setItem("refresh_token", res.refreshToken);
      setToken(res.accessToken);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "Welcome back!", description: "Successfully logged in." });
      setLocation("/dashboard");
    } catch (err: any) {
      toast({ 
        title: "Login failed", 
        description: err.message || "Invalid credentials", 
        variant: "destructive" 
      });
      throw err;
    }
  };

  const handleSignup = async (data: AuthRequest) => {
    try {
      const res = await apiSignup(data);
      localStorage.setItem("access_token", res.accessToken);
      localStorage.setItem("refresh_token", res.refreshToken);
      setToken(res.accessToken);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "Account created", description: "Welcome to Nutterx Hosting!" });
      setLocation("/dashboard");
    } catch (err: any) {
      toast({ 
        title: "Signup failed", 
        description: err.message || "Failed to create account", 
        variant: "destructive" 
      });
      throw err;
    }
  };

  const handleLogout = async () => {
    try {
      const refresh = localStorage.getItem("refresh_token");
      if (refresh) {
        await apiLogout({ refreshToken: refresh });
      }
    } catch (e) {
      // Ignore errors on logout
    } finally {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      setToken(null);
      queryClient.clear();
      setLocation("/login");
    }
  };

  return (
    <AuthContext.Provider 
      value={{ 
        user: user || null, 
        isLoading: !!token && isUserLoading, 
        login: handleLogin, 
        signup: handleSignup, 
        logout: handleLogout 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
