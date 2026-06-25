import { BehaviorNav } from "@/components/BehaviorNav";

// Wraps every Behavior page with the module's sub-navigation.
export default function BehaviorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BehaviorNav />
      {children}
    </>
  );
}
