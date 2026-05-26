const SITE_ROOT = "spec-site";
const CNAME = "anchr-spec.org";

interface SchemaPageCheck {
  readonly url: string;
  readonly path: string;
}

const pages: readonly SchemaPageCheck[] = [
  {
    url: "https://anchr-spec.org/spec/proof/tlsn/v1",
    path: "spec-site/spec/proof/tlsn/v1/index.html",
  },
  {
    url: "https://anchr-spec.org/spec/proof/c2pa-image/v1",
    path: "spec-site/spec/proof/c2pa-image/v1/index.html",
  },
];

const requiredSections = [
  "Predicate Shape",
  "Proof Payload Shape",
  "Response Data Shape",
  "Verification Requirements",
] as const;

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

function assertIncludes(haystack: string, needle: string, path: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${path} must include ${needle}`);
  }
}

const cname = (await readText(`${SITE_ROOT}/CNAME`)).trim();
if (cname !== CNAME) {
  throw new Error(`${SITE_ROOT}/CNAME must be ${CNAME}`);
}

await readText(`${SITE_ROOT}/index.html`);
await readText(`${SITE_ROOT}/README.md`);

for (const page of pages) {
  const html = await readText(page.path);
  assertIncludes(html, page.url, page.path);
  for (const section of requiredSections) {
    assertIncludes(html, section, page.path);
  }
}

console.log("proof schema pages check passed");
