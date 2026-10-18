import ResearchHome from "@/components/repopilot/ResearchHome";

export default function Page() {
  return (
    <ResearchHome
      mode={process.env.REPOPILOT_MODE === "live" ? "live" : "mock"}
    />
  );
}
