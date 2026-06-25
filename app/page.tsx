import Dashboard from "@/components/Dashboard";
import { GOLD_CONFIG } from "@/lib/instruments/config";

export default function Home() {
  return <Dashboard cfg={GOLD_CONFIG} />;
}
