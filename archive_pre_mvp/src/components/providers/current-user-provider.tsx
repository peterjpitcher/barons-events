"use client";

import { createContext, useContext } from "react";
import type { UserProfile } from "@/lib/profile";

type CurrentUserContextValue = UserProfile | null;

const CurrentUserContext = createContext<CurrentUserContextValue | undefined>(
  undefined
);

type CurrentUserProviderProps = {
  user: UserProfile | null;
  children: React.ReactNode;
};

export function CurrentUserProvider({
  user,
  children,
}: CurrentUserProviderProps) {
  return (
    <CurrentUserContext.Provider value={user}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const value = useContext(CurrentUserContext);

  if (value === undefined) {
    throw new Error("useCurrentUser must be used within <CurrentUserProvider>");
  }

  return value;
}
