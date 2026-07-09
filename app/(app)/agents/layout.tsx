import { AgentsNav } from "@/components/AgentsNav";

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AgentsNav />
      {children}
    </>
  );
}
