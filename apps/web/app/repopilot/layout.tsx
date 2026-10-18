import Dashboard from "../dashboard/layout";

export default function RepoPilotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Dashboard modal={null}>{children}</Dashboard>;
}
