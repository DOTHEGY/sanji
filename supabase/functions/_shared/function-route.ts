// Supabase may pass either /<function>/... or /functions/v1/<function>/... .
// Never assume the editor's generated function name matches a source folder.
export function functionRoute(requestUrl: string, projectUrl: string) {
  const url = new URL(requestUrl),
    parts = url.pathname.split("/").filter(Boolean);
  const offset = parts[0] === "functions" && parts[1] === "v1" ? 2 : 0;
  const name = parts[offset];
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error("Invalid function route");
  return {
    name,
    path: "/" + parts.slice(offset + 1).join("/"),
    base: projectUrl.replace(/\/$/, "") + "/functions/v1/" + name,
  };
}
