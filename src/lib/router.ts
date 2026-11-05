import { useEffect, useState } from "react";

export type Route = "chat" | "admin" | "builder" | "documents" | "agent";

export function getRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h.startsWith("admin")) return "admin";
  if (h.startsWith("builder")) return "builder";
  if (h.startsWith("documents")) return "documents";
  if (h.startsWith("agent")) return "agent";
  return "chat";
}

export function navigate(route: Route) {
  window.location.hash = route === "chat" ? "/" : `/${route}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(getRoute());
  useEffect(() => {
    const onChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
