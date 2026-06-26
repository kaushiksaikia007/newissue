import { redirect } from "next/navigation";

// Markets are now tabs on "/". Keep this path working for old links.
export default function Nifty50Page() {
  redirect("/");
}
