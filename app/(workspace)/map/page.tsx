import { MapPageClient } from "@/components/pages/map-page-client";

export const dynamic = "force-dynamic";

export default function MapPage() {
  return <MapPageClient mode="workspace" />;
}
