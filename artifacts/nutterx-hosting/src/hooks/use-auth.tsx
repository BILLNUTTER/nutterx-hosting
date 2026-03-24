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

  // Patch native fetch globally if needed by customFetch to always inject token
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const currentToken = localStorage.getItem("access_token");
      if (currentToken && typeof input === "string" && input.startsWith("/api/")) {
        init = { ...init };
        // Use new Headers() so we preserve existing headers (including Content-Type)
        // regardless of whether init.headers is a plain object, Headers instance, or array
        const headers = new Headers(init.headers as HeadersInit | undefined);
        headers.set("Authorization", `Bearer ${currentToken}`);
        init.headers = headers;
      }
      return originalFetch(input, init);
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    }
  });

  useEffect(() => {
    if (error) {
      // If unauthorized, clear tokens and prompt re-login
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
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
