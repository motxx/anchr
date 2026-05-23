export function moduleDir(meta: ImportMeta): string {
  const pathname = decodeURIComponent(new URL(meta.url).pathname);
  const slash = pathname.lastIndexOf("/");
  if (slash <= 0) return "/";
  return pathname.slice(0, slash);
}
