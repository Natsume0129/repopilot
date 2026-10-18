import recorded from "./fixtures/github.json";
import { ResearchError } from "./github";

export const fixtureRecordedAt = recorded.recordedAt;
export const fixtureResponses: Record<string, unknown> = recorded.responses;
// Never falls back to fetch. Unknown fixture tools fail closed.
export const fixtureFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.github.com")
    throw new ResearchError("MOCK_NETWORK", "Mock 禁止外部网络访问");
  const key = url.pathname + url.search;
  if (url.pathname === "/search/repositories")
    return Response.json({
      items: [fixtureResponses["/repos/langchain-ai/langgraph"]],
    });
  if (key in fixtureResponses) return Response.json(fixtureResponses[key]);
  if (
    url.pathname.endsWith("/issues") &&
    Number(url.searchParams.get("page")) > 1
  )
    return Response.json([]);
  return Response.json({ message: "No recorded fixture" }, { status: 404 });
};
