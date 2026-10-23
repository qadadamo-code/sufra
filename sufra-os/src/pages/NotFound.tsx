import { Compass } from "lucide-react";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { homeFor } from "@/modules/registry";
import { EmptyState, LinkButton } from "@/ui";

export function NotFound() {
  const { t } = useT();
  const { role } = useSession();
  return <EmptyState className="mt-10" icon={<Compass />} title={t("notFound.title")} body={t("notFound.body")} action={<LinkButton to={homeFor(role)}>{t("soon.home")}</LinkButton>} />;
}
