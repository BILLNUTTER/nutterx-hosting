import { ReactNode } from "react";
import { Navbar } from "@/components/Navbar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] nx-shell flex flex-col">
      <Navbar />
      <main className="flex-1 relative">
        <div className="relative z-10 max-w-[1400px] mx-auto w-full px-4 sm:px-6 lg:px-10 py-7 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
