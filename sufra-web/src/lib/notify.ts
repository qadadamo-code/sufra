import { useSyncExternalStore } from "react";
import type { FeedbackItem } from "@/components/ui/matte-stack-feedback";

let items: FeedbackItem[] = [];
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

export function notify(n: Omit<FeedbackItem, "id"> & { ttl?: number }) {
  const id = Math.random().toString(36).slice(2);
  items = [...items, { ...n, id }].slice(-23);
  emit();
  const ttl = n.ttl ?? 6500;
  if (ttl > 0) window.setTimeout(() => dismiss(id), ttl);
  return id;
}
export function dismiss(id: string) {
  items = items.filter((i) => i.id !== id);
  emit();
}
export function useNotifications() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => items,
  );
}
