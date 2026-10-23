import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { translate, type Lang } from "@/i18n/i18n";
import { Button, EmptyState } from "@/ui";

export class ErrorBoundary extends Component<{ children: ReactNode; lang: Lang; resetKey?: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error(error);
  }
  override componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render() {
    if (!this.state.error) return this.props.children;
    const l = this.props.lang;
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title={translate(l, "error.title")}
        body={translate(l, "error.body")}
        action={<Button onClick={() => this.setState({ error: null })}>{translate(l, "common.retry")}</Button>}
      />
    );
  }
}
