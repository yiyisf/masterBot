import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CMaster Bot | AI Assistant",
  description: "Enterprise AI Assistant with extensible skills",
};

import { ThemeProvider } from "@/components/theme-provider";
import { ModeToggle } from "@/components/mode-toggle";

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
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="h-svh overflow-hidden flex flex-col">
              <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 transition-all">
                <div className="flex items-center gap-2">
                  {/* SidebarTrigger 已移至侧边栏内部 */}
                </div>
                <ModeToggle />
              </header>
              <main className="flex flex-1 flex-col overflow-hidden p-6">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
