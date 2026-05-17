"use client";

import * as React from "react";
import { CommandPalette } from "@/components/command-palette";

interface CommandPaletteContextValue {
  open: () => void;
  close: () => void;
}

const CommandPaletteContext = React.createContext<CommandPaletteContextValue>({
  open: () => {},
  close: () => {},
});

export function useCommandPalette() {
  return React.useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = React.useState(false);

  // Global Cmd+K / Ctrl+K shortcut
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const ctx = React.useMemo(
    () => ({ open: () => setIsOpen(true), close: () => setIsOpen(false) }),
    [],
  );

  return (
    <CommandPaletteContext.Provider value={ctx}>
      {children}
      <CommandPalette open={isOpen} onOpenChange={setIsOpen} />
    </CommandPaletteContext.Provider>
  );
}
