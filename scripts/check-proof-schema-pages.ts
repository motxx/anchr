const SITE_ROOT = "spec-site";
const CNAME = "anchr-spec.org";
const MANIFEST_PATH = `${SITE_ROOT}/schemas.json`;

interface SchemaPageCheck {
  readonly url: string;
  readonly path: string;
}

const requiredSections = [
  "Predicate Shape",
  "Proof Payload Shape",
  "Response Data Shape",
  "Verification Requirements",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readText(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`missing required file: ${path}`);
    }
    throw error;
  }
}

function readStringField(
  entry: Record<string, unknown>,
  field: "url" | "path",
  location: string,
): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${location}.${field} must be a non-empty string`);
  }
  return value;
}

function parseManifest(raw: string): readonly SchemaPageCheck[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${MANIFEST_PATH} must be valid JSON: ${errorMessage(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `${MANIFEST_PATH} must be an array of { url, path } entries`,
    );
  }
  if (parsed.length === 0) {
    throw new Error(`${MANIFEST_PATH} must list at least one schema page`);
  }

  const urls = new Set<string>();
  const paths = new Set<string>();
  return parsed.map((entry, index) => {
    const location = `${MANIFEST_PATH}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${location} must be an object with url and path`);
    }

    const url = readStringField(entry, "url", location);
    const path = readStringField(entry, "path", location);
    if (!path.startsWith(`${SITE_ROOT}/`)) {
      throw new Error(`${location}.path must stay under ${SITE_ROOT}/`);
    }
    if (urls.has(url)) {
      throw new Error(`${MANIFEST_PATH} contains duplicate url: ${url}`);
    }
    if (paths.has(path)) {
      throw new Error(`${MANIFEST_PATH} contains duplicate path: ${path}`);
    }
    urls.add(url);
    paths.add(path);

    return { url, path };
  });
}

function assertIncludes(haystack: string, needle: string, path: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${path} must include ${needle}`);
  }
}

async function readSchemaPage(page: SchemaPageCheck): Promise<string> {
  try {
    return await Deno.readTextFile(page.path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `${MANIFEST_PATH} lists missing page for ${page.url}: ${page.path}`,
      );
    }
    throw error;
  }
}

const cname = (await readText(`${SITE_ROOT}/CNAME`)).trim();
if (cname !== CNAME) {
  throw new Error(`${SITE_ROOT}/CNAME must be ${CNAME}`);
}

await readText(`${SITE_ROOT}/index.html`);
await readText(`${SITE_ROOT}/README.md`);

const pages = parseManifest(await readText(MANIFEST_PATH));
for (const page of pages) {
  const html = await readSchemaPage(page);
  assertIncludes(html, page.url, page.path);
  for (const section of requiredSections) {
    assertIncludes(html, section, page.path);
  }
}

console.log("Proof Schema pages check passed");
