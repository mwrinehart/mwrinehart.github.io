import { NarrativeNav } from "@/components/NarrativeNav";

// Wraps every Narrative page with the module's sub-navigation.
export default function NarrativeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NarrativeNav />
      {children}
    </>
  );
}
