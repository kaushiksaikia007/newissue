import Dashboard from "@/components/Dashboard";
import { NIFTY_CONFIG } from "@/lib/instruments/config";

export default function Nifty50Page() {
  return <Dashboard cfg={NIFTY_CONFIG} />;
}
