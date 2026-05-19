import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppSidebar } from "@/components/sidebar";
import {
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";

const inter = localFont({
  src: [
    { path: "../fonts/inter-latin.woff2", style: "normal" },
    { path: "../fonts/inter-latin-ext.woff2", style: "normal" },
  ],
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CMaster Bot | AI Assistant",
  description: "Enterprise AI Assistant with extensible skills",
};

import { ThemeProvider } from "@/components/theme-provider";
import { ModeToggle } from "@/components/mode-toggle";
import { Toaster } from "@/components/ui/sonner";
import { CommandPaletteProvider } from "@/components/command-palette-provider";
import { OnboardingTour } from "@/components/onboarding-tour";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body className={`${inter.className} bg-background text-foreground antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <CommandPaletteProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset className="h-svh overflow-hidden flex flex-col">
                <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 transition-all">
                  <div />
                  <ModeToggle />
                </header>
                <main className="flex flex-1 flex-col overflow-hidden p-6">
                  {children}
                </main>
              </SidebarInset>
            </SidebarProvider>
            <Toaster />
            <OnboardingTour />
            <ServiceWorkerRegistrar />
          </CommandPaletteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
