import { registerSchemaBundle } from "../../../schema.ts";
import { createC2paImageSchemaBundle } from "../../c2pa-image-schema.ts";
import { createGenericMediaSchemaBundle } from "../../generic-media-schema.ts";
import { createTlsnSchemaBundle } from "../../tlsn-schema.ts";

let registered = false;

export function ensureReferenceSchemaBundlesRegistered(): void {
  if (registered) return;
  registerSchemaBundle(createGenericMediaSchemaBundle());
  registerSchemaBundle(createTlsnSchemaBundle());
  registerSchemaBundle(createC2paImageSchemaBundle());
  registered = true;
}
