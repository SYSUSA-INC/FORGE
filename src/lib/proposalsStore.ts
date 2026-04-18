"use client";

import type { Proposal } from "@/lib/mock";
import { useSyncExternalStore } from "react";

// Client-only in-memory + localStorage-persisted proposals store.
// Will later be replaced by a tRPC proposal.* router backed by Postgres.

const KEY = "forge.proposals.v1";

type Listener = () => void;

function loadFromStorage(): Proposal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Proposal[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(next: Proposal[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // quota exceeded or disabled
  }
}

let state: Proposal[] = [];
let hydrated = false;
const listeners = new Set<Listener>();

function hydrate() {
  if (!hydrated && typeof window !== "undefined") {
    state = loadFromStorage();
    hydrated = true;
  }
}

function emit() {
  saveToStorage(state);
  listeners.forEach((l) => l());
}

export const proposalsStore = {
  getSnapshot(): Proposal[] {
    hydrate();
    return state;
  },
  getServerSnapshot(): Proposal[] {
    return [];
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    // also listen for cross-tab updates
    const handler = (e: StorageEvent) => {
      if (e.key === KEY) {
        state = loadFromStorage();
        listener();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", handler);
    }
    return () => {
      listeners.delete(listener);
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", handler);
      }
    };
  },
  add(p: Proposal) {
    hydrate();
    state = [p, ...state];
    emit();
  },
  update(id: string, patch: Partial<Proposal>) {
    hydrate();
    state = state.map((p) => (p.id === id ? { ...p, ...patch } : p));
    emit();
  },
  remove(id: string) {
    hydrate();
    state = state.filter((p) => p.id !== id);
    emit();
  },
  clear() {
    state = [];
    emit();
  },
};

export function useProposals(): Proposal[] {
  return useSyncExternalStore(
    proposalsStore.subscribe,
    proposalsStore.getSnapshot,
    proposalsStore.getServerSnapshot,
  );
}

export function makeProposalCode(): string {
  const n = 1000 + Math.floor(Math.random() * 9000);
  return `FRG-${n}`;
}

export function daysUntil(iso: string): number {
  if (!iso) return 30;
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return 30;
  const now = Date.now();
  return Math.max(0, Math.round((due - now) / 86_400_000));
}
