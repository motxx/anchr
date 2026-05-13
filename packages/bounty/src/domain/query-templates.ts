/**
 * Pre-built query templates for common use cases.
 *
 * Usage:
 *   import { queryTemplates } from "anchr";
 *   const input = queryTemplates.photoProof("Shibuya crossing, Tokyo");
 */

import type { QueryInput } from "./types.ts";

export interface QueryTemplates {
  photoProof(locationOrSubject: string): QueryInput;
  storeStatus(storeName: string, location?: string): QueryInput;
  eventVerification(eventDescription: string, location?: string): QueryInput;
}

export const queryTemplates: QueryTemplates = {
  /** Request a photo proof of a location or scene. */
  photoProof(locationOrSubject: string): QueryInput {
    return {
      description: `Photo proof: ${locationOrSubject}`,
      location_hint: locationOrSubject,
    };
  },

  /** Request current status of a store or venue. */
  storeStatus(storeName: string, location?: string): QueryInput {
    return {
      description: `Store status check: ${storeName}`,
      location_hint: location ?? storeName,
    };
  },

  /** Request verification of an event or situation. */
  eventVerification(eventDescription: string, location?: string): QueryInput {
    return {
      description: `Event verification: ${eventDescription}`,
      location_hint: location,
    };
  },
};
