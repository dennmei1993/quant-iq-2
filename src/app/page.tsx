import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase";
import LandingPage from "@/components/landing/LandingPage";

export default async function RootPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");
  return <LandingPage />;
}