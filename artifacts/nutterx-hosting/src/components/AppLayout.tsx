import { ReactNode } from "react";
import { Navbar } from "@/components/Navbar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar />
      <main className="flex-1 overflow-y-auto relative">
        <div className="sticky top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-[1px] pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-[250px] bg-primary/4 blur-[120px] rounded-full" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
