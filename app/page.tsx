import { redirect } from "next/navigation";

// The platform entry point routes straight to the dashboard; middleware bounces
// unauthenticated users to /login first.
export default function Home() {
  redirect("/dashboard");
}
